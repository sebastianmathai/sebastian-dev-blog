# Move Semantics in C++: What std::move Actually Does

Status: draft  
Series: C++ Mental Models  
Standard: C++17  
Estimated reading time: 12 minutes

A LiDAR frame owns thousands of measurements. We finish decoding it and pass it to the next stage.

Should that handoff duplicate all the measurements? Or can the next stage take ownership of the existing storage?

Move semantics lets a type offer that second operation. But the spelling most associated with it—`std::move`—does not transfer a resource by itself.

The mental model is:

> std::move makes an expression eligible for operations that can consume its resources. The selected operation decides what actually happens.

## Start with the resource, not the keyword

Consider this type:

```cpp
#include <cstdint>
#include <vector>

struct Frame
{
    std::vector<std::uint32_t> measurements;
};
```

Assume these statements appear inside a function, with `<utility>` included:

```cpp
Frame first;
first.measurements.resize(20'000);

Frame copied = first;
Frame moved = std::move(first);
```

Copying the vector creates independent element storage and copies its values.

The ordinary vector move constructor can take ownership of the allocation instead. The Frame objects themselves have different addresses; the useful transfer is the vector's owned storage.

For this Frame, compiler-generated operations already use the vector's copy and move behavior. No hand-written resource management is needed.

This is the Rule of Zero in practice: choose members that express ownership, then let those members implement it.

Do not generalize this cost to every move. Moving an integer is effectively copying its value. Moving an array moves its elements. Allocator-sensitive container operations can require element-wise work. A move operation is not a universal promise of constant time.

## Value categories describe expressions

These three categories are enough to begin:

| Expression category | Example | How to think about it here |
|---|---|---|
| lvalue | `first` | Refers to an identifiable object through an expression normally treated as reusable. |
| xvalue | `std::move(first)` | Refers to an existing object in a form that permits resource reuse. |
| prvalue | `Frame{}` | Produces a value that can initialize a result object. |

Both xvalues and prvalues are rvalues.

A variable's name is normally an lvalue expression in these examples, even when the variable's declared type is an rvalue reference. Value category and declared type answer different questions.

These are language categories, not predictions of when the object will die. In particular, `std::move(first)` does not shorten `first`'s lifetime.

## std::move is a cast, not a transfer

For a non-const object of type T, `std::move(object)` produces an expression behaving like a cast to `T&&`.

It does not allocate memory, clear the source, or invoke a move constructor on its own.

For example:

```cpp
Frame first;
auto&& alias = std::move(first);
```

This binds a reference to `first`. No second Frame has been constructed and nothing has been transferred.

Now compare:

```cpp
Frame second = std::move(first);
```

Here, construction of `second` selects a constructor using the supplied expression. That constructor performs the actual work.

Even calling a function taking `Frame&&` merely binds a reference. The function must do something with that reference to move from the object.

## Watch overload resolution choose the operation

The conventional overloads look like:

```cpp
T(const T& other);            // Copy construction.
T(T&& other);                 // Move construction.
T& operator=(const T& other); // Copy assignment.
T& operator=(T&& other);      // Move assignment.
```

An rvalue does not automatically guarantee a move. A copy constructor taking `const T&` can also accept an rvalue.

This complete program makes the choices visible:

```cpp
#include <iostream>
#include <utility>

struct Trace
{
    Trace() = default;

    Trace(const Trace&)
    {
        std::cout << "copy construction\n";
    }

    Trace(Trace&&) noexcept
    {
        std::cout << "move construction\n";
    }

    Trace& operator=(const Trace&)
    {
        std::cout << "copy assignment\n";
        return *this;
    }

    Trace& operator=(Trace&&) noexcept
    {
        std::cout << "move assignment\n";
        return *this;
    }

    ~Trace() = default;
};

int main()
{
    Trace original;
    Trace copied = original;
    Trace moved = std::move(original);

    const Trace fixed;
    Trace fromConst = std::move(fixed);

    Trace target;
    target = copied;
    target = std::move(moved);

    (void)fromConst;
}
```

Expected output:

```text
copy construction
move construction
copy construction
copy assignment
move assignment
```

Trace deliberately owns no resource: it demonstrates selection, not a realistic resource-transfer implementation. Its logging uses the streams' default exception settings.

## Why moving a const object usually copies

For `const T object`, `std::move(object)` retains constness and produces a `const T&&` expression.

The usual move constructor takes `T&&`, because transferring ownership often requires changing the source's state. It cannot bind to `const T&&`.

The copy constructor's `const T&` can bind, so copying is selected when available. If no compatible operation exists, compilation fails.

This explains the third line of Trace's output.

Avoid making an owned result const when you intend to transfer its resources later. Do not cast away constness to force a move.

## Move construction and move assignment have different starting points

```cpp
Frame created = std::move(source); // Initialize a new object.
existing = std::move(created);     // Assign to an existing object.
```

The assignment target may already own resources. Its move assignment must handle those resources before adopting or assigning the incoming state.

For example, assigning one `unique_ptr` into another releases the target's previously owned object and transfers the source's ownership. The target pointer object itself remains alive.

A move constructor has no previously initialized destination resource to replace.

## Follow ownership through unique_ptr

This complete example shows an actual ownership transfer:

```cpp
#include <cassert>
#include <iostream>
#include <memory>
#include <utility>

struct Sensor
{
    explicit Sensor(int number) : id(number) {}
    int id;
};

int main()
{
    auto first = std::make_unique<Sensor>(7);
    Sensor* address = first.get();

    auto second = std::move(first);

    assert(!first);
    assert(second.get() == address);

    std::cout << std::boolalpha;
    std::cout << "Source empty: " << (first == nullptr) << '\n';
    std::cout << "Same Sensor: " << (second.get() == address) << '\n';
    std::cout << "Sensor id: " << second->id << '\n';

    first = std::make_unique<Sensor>(8);
    assert(first->id == 8);
}
```

Expected output:

```text
Source empty: true
Same Sensor: true
Sensor id: 7
```

The Sensor stayed at the same address. Its constructor was not called again during the transfer. Two smart-pointer objects existed, but ownership of the Sensor passed from one to the other.

The source smart pointer is explicitly guaranteed to become empty after this move construction. It remains a usable object and can receive a new resource.

## What may I do with a moved-from object?

For standard-library types, the general rule is a valid but unspecified state unless the particular operation provides stronger guarantees.

“Valid” means you can destroy it and perform operations whose preconditions are satisfied. “Unspecified” means you must not assume its previous value or invent a particular replacement value.

For a moved-from string, checking `empty()` is fine. Calling `front()` without first establishing that it is nonempty is not.

For your own types, define a moved-from contract. The language does not automatically repair custom invariants.

Consider a design with both an owning pointer and a separate element count. A defaulted move may move the pointer but copy the scalar count, leaving the source with a null pointer and a nonzero count. If the class requires those fields to agree, defaulted member-wise movement is insufficient.

Either design members so their ordinary operations preserve the invariant or implement the required move behavior deliberately.

## A named rvalue reference is still an lvalue expression

Assuming our Frame definition and `<utility>`, this function illustrates the distinction:

```cpp
void inspectHandoff(Frame&& incoming)
{
    Frame copied = incoming;
    Frame moved = std::move(incoming);
}
```

The name `incoming` is an lvalue expression, so the first initialization copies. Explicitly applying `std::move` makes the second initialization eligible to move.

This is useful: receiving an rvalue reference does not silently consume the argument every time you mention it.

In a deduced template parameter such as `template<class T> void relay(T&& value)`, `T&&` can instead be a forwarding reference. Use `std::forward<T>(value)` when the wrapper should preserve the caller's value category. Unconditional `std::move(value)` would also permit consuming arguments supplied as lvalues.

## Why noexcept affects container behavior

When a vector reallocates, it needs to construct existing elements in new storage.

For a copyable type whose move constructor may throw, implementations commonly copy elements so failure can leave the original elements intact. A non-throwing move makes it possible to transfer them without that particular failure risk.

The helper `std::move_if_noexcept` expresses the associated choice: prefer a const reference when copying is available and moving may throw; otherwise produce an rvalue reference.

If copying is unavailable, a vector may need to use a potentially throwing move. The operation's exception guarantees then need careful attention.

Mark a move `noexcept` only when its implementation satisfies that promise. An escaping exception from a noexcept function calls `std::terminate`.

Compiler-generated move operations derive their exception specification from the operations on bases and members. Adding `noexcept` mechanically is not a substitute for checking them.

## Do I need to write move operations myself?

Often, no.

The Frame containing a vector already has suitable generated operations. The same can be true for a type containing a `unique_ptr`: copying becomes unavailable, while moving can work.

A user-declared destructor or copy operation can suppress implicit move generation. Even `~Frame() = default;` counts as a user-declared destructor. This connects to the earlier article on deleted constructors and the Rule of Five.

If no move constructor is declared, an available copy constructor may accept an rvalue. Explicitly writing `T(T&&) = delete` is different: that deleted overload can be selected and cause an error rather than falling back to copying. A defaulted move constructor that is defined as deleted has special overload-resolution treatment; do not equate all these cases.

When custom resource management is necessary, consider destruction, copying, and moving together. With raw owning pointers, a defaulted move merely copies pointer values; it does not know how to transfer ownership or prevent double deletion.

## Return values: do not add move automatically

For a function returning a named local Frame:

```cpp
Frame makeFrame()
{
    Frame result;
    result.measurements.resize(20'000);
    return result;
}
```

The compiler may construct `result` directly in the caller's result object using named return value optimization, or NRVO. If that optimization is not applied, this return is eligible for implicit move.

Writing `return std::move(result);` prevents NRVO for that return expression. It does not improve the handoff.

In C++17, returning a same-type prvalue such as `return Frame{};` constructs the result directly, without an intermediate move. NRVO for a named local remains optional.

Return by value expresses the result clearly; let the language's return rules do their work.

## Check your understanding

For a non-const Frame `source`, what happens here?

```cpp
auto&& reference = std::move(source);
Frame destination = reference;
```

The first line binds a reference. It performs no move construction.

The second line copies: the name `reference` is an lvalue expression. To permit moving from the referenced Frame, use `std::move(reference)` at the construction site.

## Takeaways

- std::move changes how an expression participates in overload resolution; it does not transfer resources itself.
- The chosen constructor, assignment operator, or function performs the work.
- Constness, available overloads, and exception specifications can change whether copying occurs.
- A moved-from object remains alive; use it according to its type's contract.
- Prefer resource-owning members and generated operations when they preserve your invariants.

## References and verification

- [C++17 working draft: move and forwarding helpers](https://timsong-cpp.github.io/cppwp/n4659/forward)
- [Copy and move constructors](https://eel.is/c++draft/class.copy.ctor)
- [Moved-from standard-library objects](https://eel.is/c++draft/lib.types.movedfrom)
- [unique_ptr constructors](https://eel.is/c++draft/unique.ptr.single.ctor)
- [Vector constructors](https://eel.is/c++draft/vector.cons)
- [Vector capacity and exception guarantees](https://eel.is/c++draft/vector.capacity)
- [C++17 working draft: copy/move elision](https://timsong-cpp.github.io/cppwp/n4659/class.copy.elision)

Working-draft links may evolve; examples here target C++17.

Verification: the two complete programs were compiled with GCC 13.3.0 using `-std=c++17 -Wall -Wextra -pedantic` and produced the outputs shown. The unique_ptr program's ownership assertions passed. Other snippets illustrate individual declarations or operations and require the surrounding definitions described in the text.
