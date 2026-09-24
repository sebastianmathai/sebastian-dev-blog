# Scope, Storage, Linkage, and Lifetime: Four Different Questions in C++

Status: draft  
Series: C++ Mental Models — Part 4  
Standard: C++17  
Estimated reading time: 12 minutes

Does a local `const` variable live in read-only memory? Does `static` mean a variable is global? If a constant is defined in a header, does every source file share the same object?

These questions become easier when we stop asking one overloaded question—“Where does this variable live?”—and separate four properties.

| Property | Question it answers |
|---|---|
| Scope | Where can name lookup find this declaration? |
| Storage duration | How long is the object's storage available? |
| Linkage | Can declarations of a name refer to the same entity across scopes or translation units? |
| Lifetime | When does a particular object begin and end its existence in that storage? |

Then ask two additional questions: **may I modify it through this access, and must its initializer be a constant expression?** Those are where `const` and `constexpr` enter the discussion.

This article covers ordinary C++17 source files and headers. It does not cover C++20 modules.

## One local name, one persistent counter

Consider this complete program:

```cpp
#include <iostream>

int nextId()
{
    static int id = 0;
    return ++id;
}

int main()
{
    std::cout << nextId() << ' ' << nextId() << '\n';
}
```

It prints:

```text
1 2
```

Apply the four questions:

| Property of `id` | Answer |
|---|---|
| Scope | Block scope inside `nextId`. |
| Storage duration | Static: its storage persists for the program's duration. |
| Linkage | No linkage: this local name does not identify a shared entity through declarations in other scopes. |
| Lifetime | The initialized integer survives returns from `nextId`; a fresh integer is not created on every call. |

The function's name `nextId` has its own scope and linkage. Do not transfer those properties to the local name `id`.

Also, no linkage does not mean the object cannot be accessed from elsewhere. A function could return a pointer or reference to it. Linkage concerns names; access through a pointer is a different mechanism.

## Storage duration is not a memory-map address

C++ has four storage-duration categories:

| Category | Typical example |
|---|---|
| Automatic | An ordinary local variable or function parameter. |
| Static | A namespace-scope variable or a local declared `static`. |
| Thread | A variable declared `thread_local`, with a separate instance per thread. |
| Dynamic | An object created with an allocating `new` expression, often managed by a smart pointer. |

“Stack,” “heap,” “register,” and sections such as `.rodata` describe implementation choices. They are useful when studying an executable or embedded linker map, but are not replacements for these language categories.

For example, an optimizer may eliminate a local integer entirely while preserving every observable result.

Look at this function-body fragment:

```cpp
auto sensor = std::make_unique<Sensor>();
```

Assuming the usual `<memory>` include and a constructible `Sensor`:

- The local `unique_ptr` object has automatic storage duration.
- The allocated `Sensor` has dynamic storage duration.
- Its non-static data members are subobjects of that Sensor and share its storage duration.

The ownership connection does not make the pointer object and the Sensor the same object.

## Const and constexpr do not select a storage category

Inside a function, all three variables below have automatic storage duration:

```cpp
int samples = 80;
const int limit = 260;
constexpr int columns = 250;
```

`const` restricts modification. `constexpr` on an object also makes it const and requires constant-expression initialization in C++17.

Neither keyword makes a local variable static. You can request that separately:

```cpp
static constexpr int columns = 250;
```

A runtime-initialized const variable is perfectly valid:

```cpp
const int port = readPortFromConfiguration();
```

Assuming the function returns an integer, this means “initialize from the configuration and do not modify this integer afterward.” It does not promise that the value was known during compilation.

Conversely, a `constexpr` object is still an object in the C++ model. Constant evaluation does not mean that the source declaration has no storage duration or can never have its address taken. Whether a physical memory location is needed depends on observable use and optimization.

## Static changes meaning with its context

Compare these fragments:

```cpp
// At namespace scope:
static int packetCount = 0;

// Inside a function:
static int retryCount = 0;

// Inside a class definition:
inline static int deviceCount = 0;
```

| Context | Main effect |
|---|---|
| Namespace-scope `static` | Gives the name internal linkage; the variable already has static storage duration. |
| Block-scope `static` | Gives the variable static storage duration while retaining its local scope. |
| Static data member | Declares a separate object associated with the class, rather than one subobject in every instance. |

The member example uses C++17 `inline` so its in-class declaration is also a definition suitable for a header.

The same spelling answers different questions depending on where it appears. Always read the enclosing context before interpreting `static`.

## Translation units: why headers can multiply objects

For a conventional build, think of a translation unit as a source file after preprocessing has incorporated its included headers.

If `a.cpp` and `b.cpp` both include `settings.hpp`, each translation unit sees declarations from that header. An include guard prevents repeat inclusion within a translation unit; it does not merge objects across translation units.

For ordinary first declarations in a named or global namespace:

| Declaration in a header | Result when included by multiple translation units |
|---|---|
| `int count = 0;` | Multiple definitions of an ordinary externally linked variable: violates the one-definition rule. |
| `static int count = 0;` | A separate internally linked object per translation unit. |
| `const int limit = 260;` | Normally a separate internally linked constant per translation unit. |
| `constexpr int limit = 260;` | Also normally a separate internally linked constant per translation unit. |
| `inline constexpr int limit = 260;` | A shared inline variable with external linkage, under the inline-definition rules. |
| `extern int count;` | A declaration; provide one definition in a source file when the object is used. |

The const rows assume no earlier declaration establishes different linkage. Namespace-scope const linkage has exceptions; it is not a universal “const means private” rule.

Multiple definitions of an inline variable must satisfy the one-definition rule, including matching definitions. `inline` is not permission to give the same variable different values in different files.

## A three-file experiment: same value, different identity

These files form one complete program.

**settings.hpp**

```cpp
#ifndef SETTINGS_HPP
#define SETTINGS_HPP

namespace settings
{
    constexpr int perTranslationUnit = 260;
    inline constexpr int shared = 260;
}

const int* addressFromOtherFile();
const int* sharedAddressFromOtherFile();

#endif
```

**other.cpp**

```cpp
#include "settings.hpp"

const int* addressFromOtherFile()
{
    return &settings::perTranslationUnit;
}

const int* sharedAddressFromOtherFile()
{
    return &settings::shared;
}
```

**main.cpp**

```cpp
#include "settings.hpp"
#include <iostream>

int main()
{
    std::cout << std::boolalpha;

    std::cout << (&settings::perTranslationUnit ==
                  addressFromOtherFile()) << '\n';

    std::cout << (&settings::shared ==
                  sharedAddressFromOtherFile()) << '\n';
}
```

Build and run:

```sh
g++ -std=c++17 -Wall -Wextra -pedantic main.cpp other.cpp -o linkage-demo
./linkage-demo
```

Expected output:

```text
false
true
```

Both constants have the same integer value. Their identity is what differs.

This matters if an API compares addresses, stores references, or uses an object's address as a key. For simple arithmetic, a per-translation-unit constant may be entirely adequate.

Notice that the address-returning functions are defined in `other.cpp`. We are deliberately exposing each object's address without putting an externally linked inline function that refers to a per-file object in the header.

## Class constants: per object or shared?

Consider this complete class definition:

```cpp
struct SensorConfig
{
    const int port = 2368;
    static constexpr int rows = 80;
    inline static int configuredDevices = 0;
};
```

Each `SensorConfig` contains its own `port`. The two static members are separate from those instances.

In C++17, a `static constexpr` data member is implicitly inline. It does not need an additional out-of-class definition when its address is used.

A non-static data member cannot itself be declared `constexpr`. Use a const member for per-instance immutable data, a `static constexpr` member for a shared constant, or a constexpr complete object when appropriate.

A static const member does not prevent instances from being copied or assigned: it is not a member subobject that those operations must copy or assign. In this example, the non-static `const int port` is what prevents generated assignment from assigning every member.

## Lifetime is not just storage availability

Storage is the region where an object can exist. Lifetime tracks the particular object occupying it.

For the ordinary class objects in this article, lifetime begins after suitable storage is obtained and initialization completes. A class object's lifetime ends when its destructor call starts; destruction itself has special rules for accessing members. Storage can remain available after that.

This complete program demonstrates reusing one region of storage:

```cpp
#include <iostream>
#include <new>

struct Reading
{
    int value;

    ~Reading()
    {
        std::cout << "Destroy " << value << '\n';
    }
};

int main()
{
    alignas(Reading) unsigned char storage[sizeof(Reading)];

    Reading* first = new (storage) Reading{10};
    first->~Reading();

    Reading* second = new (storage) Reading{20};
    second->~Reading();
}
```

Expected output:

```text
Destroy 10
Destroy 20
```

The aligned byte buffer remains available throughout both constructions. Two successive Reading objects use it. Placement new constructs an object at the supplied address; this form does not allocate another buffer.

This example is for understanding lifetime. Ordinary application code should usually express ownership with values, containers, and RAII rather than manual destruction.

The everyday consequence is simpler: a dangling pointer does not become safe merely because its old bytes still appear to contain the expected value.

## Initialization timing is another separate question

A local static that needs dynamic initialization is initialized when control first reaches its declaration. If concurrent calls arrive, initialization is coordinated; if initialization throws, a later entry can retry.

A constant-initialized local static such as our integer counter does not need that runtime construction story.

In either case, initialization safety does not synchronize subsequent operations. Concurrent unsynchronized calls to our `nextId()` can race on `++id`.

For namespace-scope objects, avoid assuming a convenient dynamic-initialization order across source files. If one object's constructor needs another service, explicit ownership and startup order often make the dependency easier to verify.

A function-local static can defer a service's construction until first use, but it does not automatically solve recursive initialization, destruction order, or shared-state synchronization.

## What changes at a DLL boundary?

Do not extend “one shared inline variable across these source files” into a promise of one process-wide instance across independently built shared libraries.

DLL exports, symbol visibility, loading, and symbol resolution depend on the platform and toolchain. ISO C++ linkage rules alone are not a complete dynamic-library contract.

For shared state across a plugin boundary, an explicit API that supplies the owning service or context is easier to reason about than assuming every module sees the same header-defined variable. Verify the actual binary interface for the target platform.

## Check your understanding

Consider this function-body fragment:

```cpp
constexpr int local = 80;
static const int persistent = 260;
auto owned = std::make_unique<int>(250);
```

Which objects survive return from the function?

- `local` does not gain a longer lifetime because it is constexpr.
- `persistent` survives the return.
- The local `owned` smart pointer is destroyed on return. If ownership has not been transferred, it destroys its allocated integer too.

Dynamic allocation permits a lifetime independent of the current scope; it does not guarantee that the object actually outlives that scope. Ownership decides when cleanup happens.

## Takeaways

Before choosing a keyword, answer:

1. Where should the name be usable?
2. How long should storage remain available?
3. Should other translation units refer to the same entity?
4. When is the object initialized and destroyed?
5. Should its value be modifiable, and must initialization be a constant expression?

These questions prevent a local name from being mistaken for a short-lived object, a constant value from being mistaken for a storage location, and repeated header definitions from being mistaken for shared identity.

## References and verification

- [C++ working draft: scope](https://eel.is/c++draft/basic.scope.scope)
- [Storage duration](https://eel.is/c++draft/basic.stc)
- [Linkage](https://eel.is/c++draft/basic.link)
- [Object lifetime](https://eel.is/c++draft/basic.life)
- [Block declarations and local static initialization](https://eel.is/c++draft/stmt.dcl)
- [Constexpr declarations](https://eel.is/c++draft/dcl.constexpr)
- [Inline declarations](https://eel.is/c++draft/dcl.inline)
- [Static data members](https://eel.is/c++draft/class.static.data)

These working-draft links evolve; the examples target C++17.

Verification: GCC 13.3.0 with `-std=c++17 -Wall -Wextra -pedantic`. The counter printed `1 2`; the three-file program printed `false` and `true`; the lifetime example printed `Destroy 10` and `Destroy 20`. Fragments are labeled or introduced as such and are not standalone programs.
