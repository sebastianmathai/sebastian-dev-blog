# Designing C++ Classes: Start with the Invariant, Not the Noun

Status: draft  
Author: Sebastian Mathai  
Series: C++ Mental Models  
Standard: C++17  
Estimated reading time: 10 minutes

A LiDAR frame contains measurements arranged into rows and columns. A decoder fills it, an algorithm processes it, and a viewer displays it.

Should all those operations belong to one class? Should the dimensions live separately from the measurements? Who owns the storage?

Listing nouns—Frame, Decoder, Processor, Viewer—is a starting point, but it does not answer the most important design question:

> Which facts must remain true together, and which object is responsible for keeping them true?

That is where a useful class boundary begins.

## An invariant is a promise about valid state

An **invariant** is a condition that every valid state of an object must satisfy.

For a rectangular frame represented by dimensions and a flat vector, we might require:

```cpp
measurements.size() == rows * columns
```

This expression is a mathematical description here, not yet safe validation code: actual unsigned multiplication can overflow.

Other examples include:

- A buffer's reported length never exceeds its capacity.
- A reservation owns either one claim on inventory or no claim.
- A connection marked ready has completed the protocol's initialization.

An invariant is different from a precondition. “This frame is rectangular” describes a valid object. “The requested row exists” describes a condition on a particular operation.

The useful mental model is that construction establishes a valid state and public operations preserve it. An implementation may temporarily break a relationship internally, but it must not expose that broken state through callbacks or other observers. If an operation fails, its documented exception guarantee still matters.

The compiler does not infer these application-level promises from member names.

## Public fields make every caller a caretaker

Consider this sketch, assuming the usual standard-library headers:

```cpp
struct RawFrame
{
    std::size_t rows;
    std::size_t columns;
    std::vector<std::uint32_t> measurements;
};
```

A caller can write:

```cpp
RawFrame frame{2, 4, std::vector<std::uint32_t>(8)};
frame.rows = 100;
```

Each member is individually valid. Their relationship is not.

Every caller must now remember which combinations are allowed. The decoder, processor, and viewer may each duplicate validation—or each assume somebody else performed it.

A plain struct is not inherently wrong. It can be a useful representation of unvalidated input. The important distinction is whether the type promises validity or merely carries data awaiting validation.

Also, `struct` and `class` have the same fundamental capabilities in C++. Their default member and base access differ. The keyword alone does not enforce an invariant.

## Private fields are only the first step

Changing those members to private prevents direct access, but this interface still has a problem:

```cpp
void setRows(std::size_t rows);
void setColumns(std::size_t columns);
void setMeasurements(std::vector<std::uint32_t> measurements);
```

If each setter independently assigns one member, a caller can still create inconsistent combinations.

If each setter instead validates against the current members, transitioning from one valid shape to another may become awkward: which field can you change first?

Prefer an operation that expresses the whole intended change:

```cpp
void replace(std::size_t rows,
             std::size_t columns,
             std::vector<std::uint32_t> measurements);
```

Such an operation can validate the proposed state before committing it. A production implementation must also check multiplication overflow and choose an exception guarantee deliberately.

The improvement is not “fewer setters.” It is that the interface describes a valid transition instead of exposing individual implementation steps.

## Remove relationships you do not need to store

Before writing more validation, ask whether the representation can eliminate some inconsistent states.

Suppose the device protocol has a fixed number of samples per row. For this example, use four so the code stays small.

Instead of storing:

- a row count;
- a column count;
- a flat vector whose size must match both;

store a vector of fixed-width rows.

Each row's width is part of its type. The row count comes from the vector's size.

This is not a universal representation for every sensor. It is a deliberate choice for a fixed-width protocol.

## A complete frame example

```cpp
#include <array>
#include <cassert>
#include <cstddef>
#include <cstdint>
#include <iostream>
#include <utility>
#include <vector>

class Frame
{
public:
    static constexpr std::size_t columns = 4;
    using Row = std::array<std::uint32_t, columns>;

    explicit Frame(std::size_t rows = 0) : rows_(rows) {}

    std::size_t rowCount() const noexcept { return rows_.size(); }

    std::uint32_t sample(std::size_t row, std::size_t column) const
    {
        return rows_.at(row).at(column);
    }

    void setSample(std::size_t row, std::size_t column,
                   std::uint32_t value)
    {
        rows_.at(row).at(column) = value;
    }

    void appendRow(Row row)
    {
        rows_.push_back(std::move(row));
    }

private:
    std::vector<Row> rows_;
};

int main()
{
    Frame original(2);
    original.setSample(1, 3, 42);
    original.appendRow(Frame::Row{10, 20, 30, 40});

    Frame copy = original;
    copy.setSample(1, 3, 99);
    assert(original.sample(1, 3) == 42);

    Frame moved = std::move(original);
    assert(moved.rowCount() == 3);
    assert(moved.sample(1, 3) == 42);

    // No assumption about the moved-from vector's size.
    original = Frame(1);
    original.setSample(0, 0, 7);

    std::cout << moved.rowCount() << " rows, "
              << Frame::columns << " columns\n";
    std::cout << "Moved sample: " << moved.sample(1, 3) << '\n';
    std::cout << "Independent copy: " << copy.sample(1, 3) << '\n';
    std::cout << "Reused source: " << original.sample(0, 0) << '\n';
}
```

Output:

```text
3 rows, 4 columns
Moved sample: 42
Independent copy: 99
Reused source: 7
```

The class has a small structural promise: it contains zero or more complete rows, each with exactly four samples. An empty frame is valid.

There is no stored row count to forget to update. There is no runtime column count that can disagree with a row.

`setSample` changes a value without changing the shape. `appendRow` adds a complete row. The nested `at` calls throw `std::out_of_range` if either index is invalid, before assigning a sample.

The by-value `Row` parameter is an API choice, not a claim of zero-copy performance. Moving this array of integers still performs element-wise work; it does not transfer a heap allocation.

The example protects structure, not every possible domain rule. If measurements have a restricted numeric range, that needs an additional policy.

## Why this matters for move semantics

The previous article explained that generated move operations act on bases and members. They do not understand relationships between unrelated members.

Return to the flat-vector design:

```cpp
class FragileFrame
{
    std::size_t rows_;
    std::size_t columns_;
    std::vector<std::uint32_t> measurements_;
    // ...
};
```

An implicitly generated move can copy the two scalar dimensions while moving the vector. The source vector remains valid, but its state need not match those unchanged dimensions.

A valid moved-from vector does not automatically mean a valid application-level frame.

There are several possible solutions:

1. Implement moves that restore a documented valid source state.
2. Define a carefully restricted moved-from contract and make every affected operation respect it.
3. Change the representation so member-wise movement preserves the class's promises.

Our fixed-width row design takes the third approach. Whatever valid state the source vector has after moving, it still contains complete rows, and `rowCount()` still reports its actual size. We do not need to claim the vector becomes empty.

The example has no hand-written destructor, copy constructor, move constructor, or assignment operator. The vector manages ownership, and its operations fit the class's invariant. That is the Rule of Zero doing useful design work.

It is not an instruction to default everything regardless of the representation.

## Ownership answers a different question

An invariant describes valid state. Ownership describes responsibility for a resource's lifetime.

In our example:

| Participant | Responsibility |
| --- | --- |
| Frame | Owns its row container as a member |
| Vector | Manages the element storage it allocates |
| Decoder | Builds a frame from protocol input |
| Processing function | Reads or modifies a frame according to its parameter contract |
| Application or queue | Decides how long a particular frame is retained |

The vector member does not require a surrounding `unique_ptr` merely because it owns dynamically allocated storage. It already manages that storage.

Typical function interfaces communicate different intentions:

```cpp
void inspect(const Frame& frame); // Borrow for read-only access.
void filter(Frame& frame);        // Borrow for modification.
void enqueue(Frame frame);       // Receive a value; may copy or move.
```

These declarations are clues, not complete contracts. They do not by themselves prevent a function from storing a pointer to an argument.

For synchronous inspection, the caller can normally keep the frame alive for the call. If work continues asynchronously, retaining a reference is not enough: the design must arrange a sufficiently long lifetime, often by transferring an owned frame into a queue.

Passing `std::move(frame)` to a function taking `Frame&&` only binds a reference. As we saw in the move-semantics article, an actual consuming operation must still occur.

## A class boundary is not automatically a lifetime guarantee

Suppose a processor stores a reference to a frame.

Making that reference private does not stop the frame from being destroyed first. The processor does not own the referred-to object.

Similarly, returning a reference to internal rows may expose borrowing and invalidation rules. A const reference can prevent modification through that access path, but it does not extend the owner's lifetime.

Decide explicitly:

- Does the consumer need ownership, or only temporary access?
- Can the owner resize, replace, move, or destroy the storage while access continues?
- Can the consumer retain the reference beyond the current call?

Shared ownership can solve a genuine shared-lifetime requirement. It does not make simultaneous access to the frame's mutable data thread-safe.

Our example returns individual samples by value partly to avoid introducing these borrowing rules into a small introductory interface.

## Keep the invariant together, not the whole application

A Frame does not need to know about UDP sockets, rendering windows, log files, and reconnect timers just because those components use frame data.

A useful split is:

- The decoder handles protocol interpretation and input validation.
- The frame protects its data representation.
- Algorithms transform or inspect frames.
- The application coordinates lifetimes and execution.

Some algorithms can be non-member functions using the public interface. Membership should be justified by access and responsibility, not merely by the fact that a function mentions a Frame.

Conversely, splitting tightly related state across many tiny classes can make an invariant harder to enforce. If three objects must always change together, you need a clear operation or coordinator responsible for that transition.

An invariant helps you choose a boundary; it does not mechanically determine the entire architecture.

## Exceptions and concurrency test the design

Ask what happens halfway through an update.

For the example's `appendRow`, constructing and moving a Row of integers does not throw. If vector allocation fails, `push_back` leaves this vector unchanged. No separate metadata has already been modified.

For a more complex element type or update operation, the guarantee may be different. Check it rather than assuming all containers and all operations behave identically.

Now ask what happens if two threads use the object.

Private members and valid single-threaded operations are not synchronization. Concurrent mutation of the same Frame needs an appropriate synchronization or ownership-transfer design.

Even individually locked methods can be insufficient when a caller needs a multi-step operation to be indivisible. “Check capacity, then reserve space” may need one operation that performs both under the same lock.

Class boundaries help place that responsibility, but do not supply it automatically.

## A practical design checklist

Before adding another class or setter, write down:

1. **Valid states:** What must be true, including empty and moved-from states?
2. **Ownership:** Who releases each resource, and who only borrows it?
3. **Transitions:** Which changes must happen together?
4. **Failure:** What remains true if construction or an operation fails?
5. **Observation:** Can references, callbacks, or concurrent access expose an intermediate state?

Then look for stored facts you could derive instead.

A smaller representation often reduces the number of promises your code must maintain.

## Check your understanding

A buffer owns a `std::unique_ptr<std::byte[]>` and stores a separate length. Its invariant says a null pointer must have length zero.

Is a defaulted move sufficient?

Not by itself. Moving the pointer empties the source pointer, but moving the integer copies its value. The source can therefore retain a nonzero length.

You need to restore the source invariant, choose a different representation, or deliberately define and support a different moved-from contract. Merely making both members private does not fix the relationship.

## Takeaways

- Start with valid states and ownership responsibilities, not just a list of nouns.
- Keep interdependent state behind operations that preserve its relationships.
- Derive information when storing it would create unnecessary synchronization work.
- Check generated copy and move operations against the whole invariant.
- Treat borrowing, failure, and concurrency as explicit parts of the contract.

## References

- [C++ Core Guidelines: use class when an invariant needs protection](https://isocpp.github.io/CppCoreGuidelines/CppCoreGuidelines#Rc-struct)
- [C++ Core Guidelines: the Rule of Zero](https://isocpp.github.io/CppCoreGuidelines/CppCoreGuidelines#Rc-zero)
- [C++ working draft: copy and move constructors](https://eel.is/c++draft/class.copy.ctor)
- [C++ working draft: vector modifiers and exception guarantees](https://eel.is/c++draft/vector.modifiers)
- [C++ working draft: moved-from standard-library objects](https://eel.is/c++draft/lib.types.movedfrom)
