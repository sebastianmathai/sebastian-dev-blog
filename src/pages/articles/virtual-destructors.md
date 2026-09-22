---
layout: ../../layouts/Article.astro
title: Why Does a C++ Base Class Need a Virtual Destructor?
description: Understand deletion through a base pointer, multi-level inheritance, RAII, and the ownership contract behind virtual destructors.
date: "22 September 2026"
category: C++ mental models
readingTime: 9 min read
---

One of the first rules we encounter when learning C++ inheritance is:

> If a class is intended to be used polymorphically, its destructor should usually be virtual.

It is easy to memorize this rule. But understanding **why** it exists gives us a much better mental model of C++ object lifetime and runtime polymorphism.

The examples in this article use C++17 or later.

## The problem

Consider this example:

```cpp
#include <iostream>

class Sensor
{
public:
    ~Sensor()
    {
        std::cout << "Destroying Sensor\n";
    }
};

class LidarSensor : public Sensor
{
public:
    ~LidarSensor()
    {
        std::cout << "Destroying LidarSensor\n";
    }
};
```

Now we create a derived object but access it through a base-class pointer:

```cpp
Sensor* sensor = new LidarSensor();

delete sensor;
```

At first glance, this may look reasonable. The actual object is a `LidarSensor`, so we might expect:

```text
Destroying LidarSensor
Destroying Sensor
```

But there is a problem: `Sensor::~Sensor()` is **not virtual**.

Deleting an object of a derived type through a pointer to a base class whose destructor is non-virtual results in **undefined behavior**.

## What does `delete` know?

The key to understanding the problem is separating two concepts:

```text
Static type  → what the pointer or reference is declared as
Dynamic type → what object actually exists
```

For:

```cpp
Sensor* sensor = new LidarSensor();
```

we have:

```text
Static type  : Sensor*
Dynamic type : LidarSensor
```

This distinction is fundamental to runtime polymorphism.

Suppose we have:

```cpp
class Sensor
{
public:
    virtual void start()
    {
        std::cout << "Sensor start\n";
    }
};

class LidarSensor : public Sensor
{
public:
    void start() override
    {
        std::cout << "LiDAR start\n";
    }
};
```

Then:

```cpp
Sensor* sensor = new LidarSensor();

sensor->start();
```

calls:

```text
LiDAR start
```

because `start()` is virtual.

Virtual dispatch tells C++ to select the implementation associated with the object's dynamic type. Destruction needs the same idea when it begins through a base pointer.

## Making the destructor virtual

We can fix the class:

```cpp
class Sensor
{
public:
    virtual ~Sensor()
    {
        std::cout << "Destroying Sensor\n";
    }
};
```

Now:

```cpp
Sensor* sensor = new LidarSensor();

delete sensor;
```

correctly destroys the complete object:

```text
delete sensor
     │
     ▼
static type = Sensor*
     │
     ▼
virtual destructor
     │
     ▼
LidarSensor::~LidarSensor()
     │
     ▼
Sensor::~Sensor()
```

This leads to a useful mental model:

> **If destruction can begin through a base-class interface, destruction must be polymorphic too.**

That is the real reason for the virtual destructor.

## What happens with three levels of inheritance?

Consider:

```cpp
class Sensor
{
public:
    virtual ~Sensor()
    {
        std::cout << "Sensor\n";
    }
};

class LidarSensor : public Sensor
{
public:
    ~LidarSensor()
    {
        std::cout << "LidarSensor\n";
    }
};

class AutomotiveLidar : public LidarSensor
{
public:
    ~AutomotiveLidar()
    {
        std::cout << "AutomotiveLidar\n";
    }
};
```

Now:

```cpp
Sensor* sensor = new AutomotiveLidar();

delete sensor;
```

produces:

```text
AutomotiveLidar
LidarSensor
Sensor
```

The most-derived object is destroyed first, followed by its base subobjects.

Notice something important:

```cpp
virtual ~Sensor();
```

was sufficient. We did not have to repeat `virtual` in every derived class. Once a member function is virtual, its overrides remain virtual throughout the inheritance hierarchy.

We can still write:

```cpp
class LidarSensor : public Sensor
{
public:
    ~LidarSensor() override = default;
};
```

This is a useful way to express intent.

`override` does not make the destructor virtual. It tells the compiler:

> I expect this destructor to override a virtual base destructor. Please verify that assumption.

That compiler check is valuable.

## Why this matters with RAII

The consequences become clearer when the derived class owns resources.

```cpp
class Sensor
{
public:
    virtual ~Sensor() = default;
};

class LidarSensor : public Sensor
{
private:
    std::vector<std::byte> receiveBuffer;
    std::unique_ptr<Socket> socket;

public:
    ~LidarSensor()
    {
        std::cout << "Cleaning up LiDAR resources\n";
    }
};
```

Imagine managing it like this:

```cpp
std::unique_ptr<Sensor> sensor =
    std::make_unique<LidarSensor>();
```

At the end of the scope, the `unique_ptr` destroys the object through a `Sensor*`.

Therefore, the base-class destruction contract matters even though we never wrote `delete` ourselves. This is particularly important in modern C++, where polymorphic objects are often managed using `std::unique_ptr<Base>` rather than raw owning pointers.

RAII does not eliminate the virtual-destructor requirement. It makes correct destruction automatic **only when the type's destruction semantics are correct**.

## Destruction is part of the interface

Developers often think about interfaces only in terms of callable functions:

```cpp
class Sensor
{
public:
    virtual void start() = 0;
    virtual void stop() = 0;
};
```

But there is another operation clients may perform:

```text
destroy this object
```

If clients own objects through `std::unique_ptr<Sensor>`, destruction is effectively part of the interface too.

A polymorphic owning interface therefore often looks like:

```cpp
class Sensor
{
public:
    virtual ~Sensor() = default;

    virtual void start() = 0;
    virtual void stop() = 0;
};
```

Now the interface supports both runtime behavior and runtime destruction through the base type.

## Should every base class have a virtual destructor?

No.

That would turn a useful rule into another rule we blindly memorize.

Consider:

```cpp
class NonPolymorphicBase
{
public:
    void helper();
};
```

If objects of derived classes are never intended to be destroyed through `NonPolymorphicBase*`, a virtual destructor may not be necessary.

The better question is:

> **Can ownership of a derived object be represented and destroyed through this base type?**

If the answer is yes, the destructor normally needs to be virtual.

For example:

```cpp
std::unique_ptr<Sensor> sensor =
    std::make_unique<LidarSensor>();
```

strongly suggests:

```cpp
virtual ~Sensor() = default;
```

because the ownership abstraction itself requires deletion through the base type.

## What about a protected non-virtual destructor?

There is another valid design.

If a base class should **not** allow deletion through a base pointer, its destructor can be protected and non-virtual:

```cpp
class Base
{
protected:
    ~Base() = default;
};
```

Then:

```cpp
Base* ptr = new Derived();

delete ptr; // compile-time error
```

The interface prevents an operation it does not support.

This gives us a stronger design principle:

```text
Public virtual destructor
        ↓
Deletion through Base* is supported

Protected non-virtual destructor
        ↓
Deletion through Base* is forbidden
```

This is more useful than simply saying every base class needs a virtual destructor. The correct destructor design depends on the ownership contract of the abstraction.

## The mental model I use

Whenever I design a base class, I ask two separate questions.

### 1. Is behavior polymorphic?

Will code do something like:

```cpp
Base* object = new Derived();

object->doSomething();
```

and expect behavior determined by the actual object type?

If yes, virtual functions may be appropriate.

### 2. Is destruction polymorphic?

Can ownership look like:

```cpp
std::unique_ptr<Base> object =
    std::make_unique<Derived>();
```

If yes, destruction through the base type must be designed correctly. Usually that means:

```cpp
virtual ~Base() = default;
```

The distinction is useful because **polymorphic behavior and polymorphic destruction are related, but they are not the same design question**.

## Final takeaway

Do not merely memorize:

> Base classes need virtual destructors.

Instead ask:

```text
How can this object be destroyed?
```

If the answer is:

```text
Derived object
     ↓
owned as Base
     ↓
destroyed through Base
```

then the base-class destruction interface must support that operation.

For a normal polymorphic ownership hierarchy, that means:

```cpp
class Base
{
public:
    virtual ~Base() = default;
};
```

The broader lesson is more important than the syntax:

> **Object lifetime is part of interface design.**

When designing C++ abstractions, do not think only about what an object can **do**. Think about who **owns** it, how long it **lives**, and through which type it will eventually be **destroyed**.

## References

- [C++ Core Guidelines C.35: A base class destructor should be either public and virtual, or protected and non-virtual](https://isocpp.github.io/CppCoreGuidelines/CppCoreGuidelines#Rc-dtor-virtual)
- [cppreference: Virtual functions — virtual destructor](https://en.cppreference.com/w/cpp/language/virtual#Virtual_destructor)
- [cppreference: `delete` expression](https://en.cppreference.com/w/cpp/language/delete)
