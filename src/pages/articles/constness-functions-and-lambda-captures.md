---
layout: ../../layouts/Article.astro
title: "Constness in C++: Which Object Are You Promising Not to Change?"
description: "Read const pointer declarations, understand top-level const, and reason about const member functions, lambda captures, and mutable callbacks."
date: "24 September 2026"
category: "C++ mental models"
readingTime: "12 min read"
---

Series: C++ Mental Models — Part 3  
Standard: C++17

A callback works when you call it directly. You capture it inside a wrapper lambda, call it in exactly the same way, and the compiler rejects it.

The event parameter is already `const`. The callback was forwarded correctly. What changed?

The wrapper introduced another object: **the closure that stores the callback**.

To understand the error, track which object each `const` applies to and how that object is accessed.

## Start with an ordinary member function

Consider this class:

```cpp
class Sensor
{
public:
    int temperature() const
    {
        return temperature_;
    }

    void setTemperature(int value)
    {
        temperature_ = value;
    }

private:
    int temperature_ = 25;
};
```

The trailing `const` in `temperature() const` qualifies access to the object on which the function is called. It does not qualify the returned integer.

Inside this function, `this` has type `const Sensor*`. Accessing `temperature_` through it does not allow modification.

A useful approximation is to imagine the object as an additional argument:

| Member call | Conceptual object access |
|---|---|
| `sensor.temperature()` | `const Sensor&` |
| `sensor.setTemperature(30)` | `Sensor&` |

This table is a reasoning aid, not a literal rewrite of C++ member-function syntax.

A non-const object can call either function. A const object can call only the const-qualified one:

```cpp
Sensor writable;
writable.setTemperature(30);
int first = writable.temperature();

const Sensor readonly;
int second = readonly.temperature();
// readonly.setTemperature(30); // Error if uncommented.
```

## Locate the const before interpreting it

These declarations make different promises:

| Declaration | Meaning |
|---|---|
| `void inspect(const Sensor& sensor);` | Access to the argument is const-qualified. |
| `int temperature() const;` | Access to the receiving object is const-qualified. |
| `const Sensor* sensor;` | The pointed-to Sensor is accessed as const; the pointer can change. |
| `Sensor* const sensor = /* ... */;` | The pointer cannot change; the Sensor can be modified through it. |
| `const Sensor* const sensor = /* ... */;` | Both restrictions apply. |

## Read simple pointer declarations from right to left

For these simple declarations, start at the variable name and read the type toward the left. Read `*` as “pointer to.” Writing the base type as `Sensor const` makes this especially easy:

| Declaration | Read it as |
|---|---|
| `Sensor* p;` | p is a pointer to Sensor. |
| `Sensor const* p;` | p is a pointer to const Sensor. |
| `Sensor* const p = &sensor;` | p is a const pointer to Sensor. |
| `Sensor const* const p = &sensor;` | p is a const pointer to const Sensor. |

`const Sensor* p` means exactly the same as `Sensor const* p`: a pointer to const Sensor. The placement of `const` on either side of the base type does not change its meaning.

For one pointer level, this gives a quick check:

- `const` **before the star** qualifies the pointed-to object.
- `const` **after the star** qualifies the pointer itself.

Here is how those restrictions differ in a function-body fragment:

```cpp
int first = 10;
int second = 20;

int const* pointerToConst = &first;
pointerToConst = &second;       // OK: change the stored address.
// *pointerToConst = 30;        // Error: modify through const access.

int* const constPointer = &first;
*constPointer = 30;             // OK: change first.
// constPointer = &second;      // Error: change the stored address.

int const* const both = &first;
// both = &second;              // Error: pointer is const.
// *both = 40;                  // Error: pointee access is const.
```

“Pointer to const” restricts modification through the pointer; it does not require the original object to have been declared const. Here, `first` remains a non-const integer.

Use this reading shortcut for simple pointer declarations. Parentheses, arrays, and function pointers require following the declarator's structure rather than blindly reading every token backward.

## Top-level const: is the object itself const?

**Top-level const qualifies the declared object itself.** For a pointer variable, that object is the pointer that holds an address.

Constness on the pointed-to type is commonly called **low-level const**.

| Declaration | Top-level const? | What is const-qualified? |
|---|---|---|
| `const int count = 10;` | Yes | The integer itself. |
| `int* const p = &value;` | Yes | The pointer itself. |
| `const int* p = &value;` | No | The pointed-to integer. |
| `const int* const p = &value;` | Yes, plus low-level const | Both pointer and pointed-to integer. |

For the pointer rows, assume `int value = 10;` already exists; each row is a separate example.

“Top-level” describes where the qualifier sits in the type, not whether `const` appears first or last in the text.

## Why const on a by-value parameter does not create an overload

Passing an integer by value initializes a separate parameter object. Making that parameter const prevents the function from assigning to its local copy.

This complete program demonstrates the distinction:

```cpp
#include <iostream>

void process(int count); // Declaration visible to callers.

void process(const int count) // Definition of the SAME function.
{
    // ++count; // Error if uncommented: local parameter is const.
    std::cout << count << '\n';
}

int main()
{
    int original = 10;
    process(original);
    ++original; // OK: the caller's integer is still mutable.
    std::cout << original << '\n';
}
```

It prints `10`, followed by `11`.

Even without the parameter's `const`, changing the local integer would not change `original`: they are separate objects.

When forming a function's type, C++ removes top-level cv-qualifiers from parameter types. It retains them for the parameter objects inside the definition. Therefore, these are two declarations of one function:

```cpp
void process(int count);
void process(const int count);
```

Providing a body for each would be a redefinition error, not two overloads. The caller supplies an integer value either way; whether the function changes its own copy is an implementation choice.

The same distinction applies when copying a pointer:

```cpp
void update(int* p);
void update(int* const p); // Same function: top-level const removed.

void inspect(int* p);
void inspect(const int* p); // Distinct overload: pointee const retained.
```

In an `update(int* const p)` definition, `p` cannot be reassigned, but `*p` can modify the caller's integer when it points to a valid non-const integer. Passing a pointer by value copies the address, not the pointed-to object.

Similarly, `inspect(Sensor&)` and `inspect(const Sensor&)` can be distinct overloads: const qualifies the referred-to Sensor. And trailing const on a member function remains significant—`read()` and `read() const` can be separate overloads.

The practical question is:

> Which object is const here: the argument, the receiving object, the pointer, or the pointee?

## Const access does not freeze every alias

Here is a complete program:

```cpp
#include <iostream>

int main()
{
    int value = 10;
    const int& view = value;

    value = 20;
    std::cout << view << '\n';
}
```

It prints `20`.

The reference prevents modification **through that reference**. It does not make the original non-const object immutable.

An object actually declared `const` is different: attempting to modify it by casting away constness causes undefined behavior. A cast cannot make a truly const object writable.

Constness is also not automatically recursive through pointers. A const wrapper can still expose a mutable pointee. For example, `const std::unique_ptr<Sensor>` prevents changing ownership through that pointer object, but it does not make the owned Sensor const. `std::unique_ptr<const Sensor>` expresses that latter restriction.

## A lambda is an object with a call operator

This lambda stores its own counter:

```cpp
auto counter = [count = 0]() mutable
{
    return ++count;
};
```

For understanding this particular example, imagine a class like:

```cpp
struct CounterClosure
{
    int count = 0;

    int operator()()
    {
        return ++count;
    }
};
```

This illustrates behavior; it is not a promise about the compiler's exact generated class or layout.

In C++17, omitting `mutable` gives the lambda a const-qualified call operator. Its stored counter would then be accessed through a const closure, so incrementing it would fail.

Lambda `mutable` permits changes to the closure's value captures. It does not make the original captured variables change, and it does not make a const closure object callable through a non-const operator.

## The captured-callback failure

Here is a complete program that intentionally fails:

```cpp
struct Event
{
    int value;
};

struct CountingCallback
{
    int calls = 0;

    void operator()(const Event&)
    {
        ++calls;
    }
};

int main()
{
    auto wrapper = [callback = CountingCallback{}](const Event& event)
    {
        callback(event); // Error: callback is accessed as const.
    };

    wrapper(Event{42});
}
```

There are two separate constness questions:

- `const Event&` controls access to the event.
- The wrapper's implicit `operator() const` controls access to its stored callback.

The callback's call operator is non-const because it updates its counter. Calling it through the const wrapper fails.

Changing the event parameter would not fix this mismatch.

## Make the invocation contract explicit

If the wrapper is intended to accept callbacks that modify their own state, give it a non-const call operator with `mutable`:

```cpp
#include <iostream>
#include <type_traits>
#include <utility>

struct Event
{
    int value;
};

struct CountingCallback
{
    int calls = 0;

    void operator()(const Event& event)
    {
        std::cout << "Call " << ++calls << ": " << event.value << '\n';
    }
};

template <typename Callback>
auto makeWrapper(Callback&& callback)
{
    return [callback = std::forward<Callback>(callback)]
           (const Event& event) mutable
    {
        callback(event);
    };
}

int main()
{
    auto wrapper = makeWrapper(CountingCallback{});

    static_assert(
        std::is_invocable_v<decltype(wrapper)&, const Event&>);
    static_assert(
        !std::is_invocable_v<const decltype(wrapper)&, const Event&>);

    wrapper(Event{42});
    wrapper(Event{43});
}
```

Expected output:

```text
Call 1: 42
Call 2: 43
```

Here, forwarding controls how the stored callback is initialized: it can copy an lvalue or move from an rvalue. The value init-capture stores its own callback object; forwarding does not turn it into a reference capture.

Invocation happens later. The wrapper's call operator determines whether that stored object is accessed as const.

This separates two decisions:

> How do I store the callback? How do I invoke the stored callback?

For an event system, choose whether handlers must be callable through const access or may update their own state. Then make the wrapper and storage mechanism support that choice. Check the actual callable wrapper's contract; type-erased wrappers can have different constness behavior from the underlying callable.

## Mutable does not mean thread-safe

Allowing the callback to increment its counter says nothing about synchronization. Concurrent invocations of the same counter without appropriate synchronization can cause a data race.

The keyword also has a distinct class-member use: a data member declared `mutable` can be changed through a const object. This is useful for implementation details such as a mutex protecting a logically read-only operation. It does not automatically make arbitrary state changes appropriate.

Neither a const member function nor a non-mutable lambda guarantees that the entire operation has no side effects.

## Reference capture keeps a separate object involved

This complete program needs no lambda `mutable`:

```cpp
#include <iostream>

int main()
{
    int calls = 0;

    const auto callback = [&calls]
    {
        ++calls;
    };

    callback();
    std::cout << calls << '\n';
}
```

It prints `1`.

There are two distinct objects here:

- `callback` is the closure object created by the lambda expression. It is const because we wrote `const auto callback`.
- `calls` is the original integer in `main()`. It was declared as `int`, so it remains non-const.

The capture `[&calls]` lets the lambda use that original integer by reference. It does not put an independent integer copy inside the closure. Therefore, `++calls` changes the integer in `main()`, rather than a value stored inside the const closure.

The lambda's default `operator() const` can be invoked on the const `callback` object. Const access to that closure does not add constness to the separate object reached through the reference.

Compare the three cases:

| Capture | Which integer does the body access? | Can the body increment it? |
|---|---|---|
| `[calls]` | A copy stored inside the closure. | No: the default call operator accesses that copy as const. |
| `[calls]() mutable` | A copy stored inside the closure. | Yes, when called on a non-const closure. |
| `[&calls]` | The original integer in `main()`. | Yes, because the original integer is non-const. |

A const pointer provides a useful analogy:

```cpp
int calls = 0;
int* const pointer = &calls;

++*pointer; // OK: modify the separate integer.
// pointer = nullptr; // Error: modify the const pointer itself.
```

The pointer is const; the integer it points to is not. Likewise, making a closure const does not make an object captured by reference const. This is an analogy about access, not a claim that the compiler must implement reference captures as pointer members.

If the original declaration were `const int calls = 0;`, then `[&calls]` would refer to a const integer, and `++calls` would fail. Adding lambda `mutable` would not fix that: it changes the closure's call operator, not the original integer's type.

Reference capture introduces a lifetime requirement: the referenced object must remain alive whenever the callback uses it. A stored subscription that outlives a local captured by reference would violate that requirement.

## Check your understanding

What does this complete program print?

```cpp
#include <iostream>

int main()
{
    int count = 0;

    auto byValue = [count]() mutable { return ++count; };
    const auto byReference = [&count]() { return ++count; };

    std::cout << byValue() << ' '
              << byValue() << ' '
              << byReference() << ' '
              << count << '\n';
}
```

Answer:

```text
1 2 1 1
```

The value capture maintains its own counter. The reference capture changes the original counter.

## Takeaways

- Identify the exact object each `const` qualifies.
- A const member function restricts access through its receiving object; it does not freeze every reachable object.
- A C++17 lambda's call operator is const unless you write `mutable`.
- Capturing a callback and invoking it are separate design decisions.
- Constness, lifetime safety, and thread safety require separate reasoning.

When a call fails because of constness, trace the receiving object of that call. In a lambda, that may be a captured object inside another object.

## References and verification

- [C++ working draft: function declarations](https://eel.is/c++draft/dcl.fct) — removal of top-level parameter cv-qualifiers when forming function types.

- [C++ working draft: cv-qualifiers](https://eel.is/c++draft/dcl.type.cv) — const access and attempts to modify const objects.
- [C++ working draft: this](https://eel.is/c++draft/expr.prim.this) — the type of the receiving-object pointer.
- [C++ working draft: closure types](https://eel.is/c++draft/expr.prim.lambda.closure) — lambda call operators.
- [C++ working draft: lambda captures](https://eel.is/c++draft/expr.prim.lambda.capture) — captured state and reference captures.
- [C++ working draft: unique_ptr observers](https://eel.is/c++draft/unique.ptr.single.observers) — access to the owned object through a const smart pointer.

The linked working draft evolves; this article targets C++17. Newer lambda features are outside its scope.

Verification: GCC 13.3.0 with `-std=c++17 -Wall -Wextra -pedantic`. The four runnable complete examples produced the outputs shown. The captured-callback example failed at invocation as intended. Both invocability assertions in the corrected wrapper passed.

The added by-value parameter example was also compiled with the same flags and printed `10` followed by `11`, confirming that the declaration and definition name the same function.
