# Constness in C++: Which Object Are You Promising Not to Change?

Status: draft  
Series: C++ Mental Models — Part 3  
Standard: C++17  
Estimated reading time: 8 minutes

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

A by-value parameter such as `void process(const int count)` makes the function's local parameter const. It says nothing about the caller's original integer. That top-level const also does not create a distinct overload from `void process(int count)`.

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

The closure is const, but the referenced integer is a separate, non-const object. This is the same distinction we saw with a const pointer object and a mutable pointee.

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

- [C++ working draft: cv-qualifiers](https://eel.is/c++draft/dcl.type.cv) — const access and attempts to modify const objects.
- [C++ working draft: this](https://eel.is/c++draft/expr.prim.this) — the type of the receiving-object pointer.
- [C++ working draft: closure types](https://eel.is/c++draft/expr.prim.lambda.closure) — lambda call operators.
- [C++ working draft: lambda captures](https://eel.is/c++draft/expr.prim.lambda.capture) — captured state and reference captures.
- [C++ working draft: unique_ptr observers](https://eel.is/c++draft/unique.ptr.single.observers) — access to the owned object through a const smart pointer.

The linked working draft evolves; this article targets C++17. Newer lambda features are outside its scope.

Verification: GCC 13.3.0 with `-std=c++17 -Wall -Wextra -pedantic`. The four runnable complete examples produced the outputs shown. The captured-callback example failed at invocation as intended. Both invocability assertions in the corrected wrapper passed.
