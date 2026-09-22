# Why Did Deleting Copy and Move Constructors Break Default Construction?

Status: draft  
Series: C++ Mental Models — Part 2  
Standard: C++17  
Estimated reading time: 7 minutes

In the previous article, we made a base-class destructor virtual so a derived object could be destroyed safely through a base pointer.

Now suppose we also want to prevent copying and moving that object. We declare those operations as deleted—and suddenly even creating a derived object fails.

Why should prohibiting a copy stop us from creating a fresh object?

The answer involves two separate decisions: **which constructors are declared**, and **whether those constructors can do their work**.

## The change that breaks the build

This is a complete example that intentionally fails to compile:

```cpp
class Sensor
{
public:
    virtual ~Sensor() = default;

    Sensor(const Sensor&) = delete;
    Sensor& operator=(const Sensor&) = delete;

    Sensor(Sensor&&) = delete;
    Sensor& operator=(Sensor&&) = delete;
};

class LidarSensor : public Sensor
{
};

int main()
{
    LidarSensor sensor; // Error: default constructor is deleted.
}
```

There is no copy or move in `main()`. We are asking for a fresh `LidarSensor`.

The problem is that constructing it also requires constructing its `Sensor` base subobject. There is no usable zero-argument constructor for that base.

## A deleted constructor is still a declaration

This line declares a constructor:

```cpp
Sensor(const Sensor&) = delete;
```

The `= delete` part forbids using it. It does not erase the declaration.

For the ordinary classes in this article, the compiler implicitly declares a default constructor only when the class has no user-declared constructors or constructor templates.

A copy constructor counts. A move constructor counts. A constructor declared with `= delete` counts too.

Declaring either of these therefore suppresses the implicit `Sensor()`:

```cpp
Sensor(const Sensor&) = delete;
Sensor(Sensor&&) = delete;
```

The assignment operators are different: they assign to an existing object and are not constructors. The destructor is not a constructor either.

## Why does the diagnostic mention the derived class?

The failure has two stages:

| Class | What happens |
|---|---|
| `Sensor` | Its user-declared constructors prevent an implicit default constructor from being declared. |
| `LidarSensor` | Its implicit default constructor is defined as deleted because it cannot default-initialize the base subobject. |

**Missing in the base** and **deleted in the derived class** describe different parts of the same failure.

An empty derived class still contains a base subobject. It cannot become a complete object while skipping construction of that subobject.

When a diagnostic mentions a deleted constructor, follow the compiler's explanatory notes. They often lead to the member or base operation that actually failed.

## The fix: explicitly permit default construction

Here is the corrected, complete program:

```cpp
#include <iostream>
#include <memory>
#include <type_traits>

class Sensor
{
public:
    virtual ~Sensor() = default;

    Sensor(const Sensor&) = delete;
    Sensor& operator=(const Sensor&) = delete;

    Sensor(Sensor&&) = delete;
    Sensor& operator=(Sensor&&) = delete;

protected:
    Sensor() = default;
};

class LidarSensor final : public Sensor
{
public:
    void start() const
    {
        std::cout << "LiDAR started\n";
    }
};

static_assert(std::is_default_constructible_v<LidarSensor>);
static_assert(!std::is_copy_constructible_v<LidarSensor>);
static_assert(!std::is_move_constructible_v<LidarSensor>);
static_assert(!std::is_copy_assignable_v<LidarSensor>);
static_assert(!std::is_move_assignable_v<LidarSensor>);

int main()
{
    LidarSensor sensor;
    sensor.start();

    std::unique_ptr<Sensor> owned =
        std::make_unique<LidarSensor>();
}
```

Expected output:

```text
LiDAR started
```

The protected constructor lets derived classes construct their base subobject while preventing ordinary client code from directly default-constructing `Sensor`.

A public `Sensor() = default;` also fixes the original problem. Access is a design choice.

The `unique_ptr` conversion here transfers ownership of the allocation. It does not move-construct the `LidarSensor` object, so deleting the object's move constructor does not prevent this ownership pattern.

## The mental model: declaration first, feasibility second

For any compiler-generated special member, ask:

1. **Will the language rules declare this operation automatically?**
2. **If declared or explicitly defaulted, can its required base and member operations succeed?**

These questions explain why `= default` is a request for the compiler's implementation, not a promise that the operation will be usable.

For example, this complete program intentionally fails:

```cpp
class Device
{
public:
    explicit Device(int port) : port_(port) {}

private:
    int port_;
};

class Monitor
{
public:
    Monitor() = default;

private:
    Device device_;
};

int main()
{
    Monitor monitor; // Error: Device has no default constructor.
}
```

Explicitly defaulting `Monitor()` cannot invent a port number. One possible fix is a default member initializer:

```cpp
Device device_{2368};
```

Another is to make the caller supply the port and initialize `device_` in a constructor. Choose according to whether the class has a meaningful default state.

## What did the virtual destructor change?

A user-declared destructor does not suppress the implicit default constructor.

It does, however, suppress implicit declaration of move construction and move assignment—even when written as:

```cpp
virtual ~Sensor() = default;
```

Here, **user-declared** means that you wrote the destructor declaration yourself. Writing `= default` asks the compiler to supply its implementation; it does not make the declaration implicit. More precisely, a destructor defaulted on its first declaration is user-declared but not user-provided. The move-generation rules care about **user-declared**.

The two rules ask different questions:

| Operation | Effect of declaring only a destructor |
|---|---|
| Default constructor | Still implicitly declared: a destructor is not a constructor. |
| Move constructor | Not implicitly declared: a user-declared destructor blocks automatic move generation. |
| Move assignment | Not implicitly declared for the same reason. |

The `virtual` keyword is not responsible for this suppression. A non-virtual `~Sensor() = default;` has the same effect on automatic move generation.

A useful design intuition is that custom destruction can signal special resource or lifetime responsibilities. Automatically moving members might not preserve those responsibilities. The language applies a fixed rule rather than inspecting whether your destructor actually needs special handling—even a defaulted destructor triggers it.

If moving is appropriate, you can explicitly declare the move operations with `= default`. They must still be valid for the class's bases and members. Remember that declaring a move constructor also means you must explicitly provide a default constructor if you want one.

Do not generalize one special-member rule to all the others.

Also, the absence of a move constructor does not necessarily make initialization from an rvalue invalid: a copy constructor taking `const T&` may accept it. Consequently, `std::is_move_constructible_v<T>` checks whether construction from `T&&` works; it does not prove that a dedicated move constructor exists.

In our corrected example, both copying and moving are explicitly prohibited, so the negative assertions express the intended policy.

## The Rule of Five is a design prompt

The Rule of Five asks us to consider these related operations together:

- Destructor
- Copy constructor
- Copy assignment
- Move constructor
- Move assignment

The default constructor is not one of those five.

Therefore, deciding all five still leaves a separate question: **how does a valid object first come into existence?**

For a device object with a stable identity, active callbacks, or a running receive loop, prohibiting copy and move may be a sensible policy. Moving such an object requires a deliberate plan for ownership and references to it.

For ordinary value types, prefer letting members manage their resources. A class containing a vector often needs no custom special members:

```cpp
#include <vector>

struct ScanFrame
{
    std::vector<float> distances;
};
```

This is the Rule of Zero: let the members provide the required lifetime behavior whenever that behavior matches the class's meaning.

## Check your understanding

Will this program compile?

```cpp
struct Configuration
{
    Configuration& operator=(const Configuration&) = delete;
};

int main()
{
    Configuration configuration;
    (void)configuration;
}
```

Yes. A copy assignment operator is not a constructor, so this declaration does not suppress the implicit default constructor.

Now replace that assignment declaration with:

```cpp
Configuration(const Configuration&) = delete;
```

Default construction fails. The class now has a user-declared constructor, and no `Configuration()` is implicitly declared.

## Takeaways

- A deleted constructor still counts as a user-declared constructor.
- Check both automatic declaration and the feasibility of base/member operations.
- Design initial construction separately from copying, moving, and destruction.

The useful question is not simply “Did I implement the Rule of Five?” It is:

> Which operations does this type support, and can every subobject participate in them?

## References and verification

- [C++ working draft: default constructors](https://eel.is/c++draft/class.default.ctor) — implicit declaration and conditions that make a defaulted constructor deleted.
- [C++ working draft: copy/move constructors](https://eel.is/c++draft/class.copy.ctor) — move suppression and fallback to copying.
- [C++ Core Guidelines C.20](https://isocpp.github.io/CppCoreGuidelines/CppCoreGuidelines#Rc-zero) — the Rule of Zero.
- [C++ Core Guidelines C.21](https://isocpp.github.io/CppCoreGuidelines/CppCoreGuidelines#Rc-five) — considering copy, move, and destruction together.

The linked working draft evolves; the examples here target C++17. Complete examples were checked with GCC 13.3.0 using `-std=c++17 -Wall -Wextra -pedantic`. The two intentionally failing programs were checked for the expected constructor diagnostics. The corrected program's five type-trait assertions passed, and it printed `LiDAR started`. The assignment-only exercise compiled; replacing its declaration with the deleted copy constructor failed as expected.
