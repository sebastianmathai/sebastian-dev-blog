# Three Bytes, One Value: Parsing Unsigned 24-Bit Network Data in C++

Status: draft  
Series: C++ Mental Models — Part 5  
Standard: C++17  
Estimated reading time: 9 minutes

A device sends 480 measurements in a UDP payload. Each measurement occupies three bytes, with the most significant byte first.

The payload therefore contains 1,440 bytes. Our application needs 480 unsigned integer values.

It is tempting to cast the received buffer to an integer pointer and start reading. But a byte buffer is a serialized representation, not an array of native C++ integers.

The useful mental model is:

> Read the protocol's bytes, assign each byte its numeric weight, and construct the value.

That approach also answers a common question: **where does the conversion to little-endian happen?**

## First, state the wire format

For this article, the payload contract is:

- Exactly 480 measurements.
- Exactly three octets per measurement.
- Unsigned values.
- Most significant octet first: big-endian order.
- No header, trailer, or checksum inside the payload passed to the decoder.

An octet means eight bits. Our implementation assumes eight-bit C++ bytes and the availability of `std::uint8_t` and `std::uint32_t`.

A real packet may contain metadata before its measurements. Identify and validate that packet structure before passing its measurement payload to this decoder.

Do not infer the layout from the word “UDP.” The device's application protocol defines the format of its payload.

## Decode the value, not the native memory layout

Suppose one value arrives as:

```text
12 34 56
```

These are hexadecimal bytes. Their weights are:

| Byte | Position in the value | Contribution |
|---|---|---|
| `0x12` | Bits 23–16 | `0x12 × 65536` |
| `0x34` | Bits 15–8 | `0x34 × 256` |
| `0x56` | Bits 7–0 | `0x56` |

The result is `0x123456`, or 1,193,046 in decimal.

A 24-bit unsigned value ranges from zero through 16,777,215, so it fits in a 32-bit unsigned integer. Portable C++ does not require a `std::uint24_t` type.

This helper performs the reconstruction:

```cpp
constexpr std::uint32_t decodeU24BE(
    std::uint8_t high,
    std::uint8_t middle,
    std::uint8_t low) noexcept
{
    return (static_cast<std::uint32_t>(high) << 16) |
           (static_cast<std::uint32_t>(middle) << 8) |
           static_cast<std::uint32_t>(low);
}
```

The shifts move each byte into its assigned bit positions. Bitwise OR combines the three non-overlapping fields.

This helper receives three values, so it has no pointer or buffer-length precondition. The caller remains responsible for reading those values safely from a packet.

## Where is the conversion to little-endian?

There is no explicit byte swap here.

The expression constructs the numeric value `0x00123456`. If that integer is stored in memory, its object representation follows the host's byte order:

| Representation | Bytes in increasing address order |
|---|---|
| Three-byte wire representation | `12 34 56` |
| Four-byte integer on a little-endian host | `56 34 12 00` |
| Four-byte integer on a big-endian host | `00 12 34 56` |

Both hosts compute the same numeric value.

The shifts specify significance mathematically; they do not depend on how a native integer is laid out in memory. Applying an additional byte swap afterward would change the value incorrectly.

Likewise, sending the raw four-byte object representation back to the device would not recreate this three-byte protocol field. Encoding must explicitly produce the protocol's three bytes.

## Why cast before shifting?

An expression such as:

```cpp
high << 16
```

does not necessarily perform arithmetic in the type of `high`. Integer promotions happen first. On common systems, a `std::uint8_t` operand promotes to `int`.

For this particular unsigned 24-bit reconstruction on a system with 32-bit `int`, the uncast expression can work: even `255 << 16` fits in the positive range. The problem is relying on that width silently. On a system with 16-bit `int`, a shift by 16 is invalid for the promoted operand.

Casting before the shift provides a type wide enough for the required positions. On the usual targets it also makes the operation unsigned; on unusual targets where that type undergoes further promotion, the promoted type can represent its values.

Casting afterward is too late:

```cpp
static_cast<std::uint32_t>(high << 16)
```

The shift is evaluated before its result is converted.

Plain `char` introduces another hazard because it may be signed. A byte with its high bit set can then become a negative value. In C++17, left-shifting a negative signed value is undefined behavior. Interpret protocol octets as unsigned before doing arithmetic.

## Validate the payload before reading any measurement

The decoder below accepts a vector containing only the measurement payload. It rejects both short and oversized payloads.

It returns `std::nullopt` for a length mismatch and a complete vector on success. Allocation failure may still throw; this is not an exception-free interface.

Here is a complete program, including boundary checks:

```cpp
#include <cassert>
#include <climits>
#include <cstddef>
#include <cstdint>
#include <iostream>
#include <optional>
#include <vector>

static_assert(CHAR_BIT == 8, "This protocol decoder requires 8-bit bytes.");

constexpr std::size_t measurementCount = 480;
constexpr std::size_t bytesPerMeasurement = 3;
constexpr std::size_t payloadBytes =
    measurementCount * bytesPerMeasurement;

constexpr std::uint32_t decodeU24BE(
    std::uint8_t high,
    std::uint8_t middle,
    std::uint8_t low) noexcept
{
    return (static_cast<std::uint32_t>(high) << 16) |
           (static_cast<std::uint32_t>(middle) << 8) |
           static_cast<std::uint32_t>(low);
}

std::optional<std::vector<std::uint32_t>> decodePayload(
    const std::vector<std::uint8_t>& payload)
{
    if (payload.size() != payloadBytes)
    {
        return std::nullopt;
    }

    std::vector<std::uint32_t> values;
    values.reserve(measurementCount);

    for (std::size_t i = 0; i < measurementCount; ++i)
    {
        const std::size_t offset = i * bytesPerMeasurement;
        values.push_back(decodeU24BE(
            payload[offset],
            payload[offset + 1],
            payload[offset + 2]));
    }

    return values;
}

static_assert(decodeU24BE(0x00, 0x00, 0x00) == 0);
static_assert(decodeU24BE(0x00, 0x00, 0x01) == 1);
static_assert(decodeU24BE(0x00, 0x01, 0x00) == 256);
static_assert(decodeU24BE(0x01, 0x00, 0x00) == 65536);
static_assert(decodeU24BE(0x12, 0x34, 0x56) == 0x123456);
static_assert(decodeU24BE(0x80, 0x00, 0x00) == 0x800000);
static_assert(decodeU24BE(0xFF, 0xFF, 0xFF) == 0xFFFFFF);

int main()
{
    std::vector<std::uint8_t> payload(payloadBytes, 0);

    payload[0] = 0x12;
    payload[1] = 0x34;
    payload[2] = 0x56;

    payload[payloadBytes - 3] = 0xFF;
    payload[payloadBytes - 2] = 0xFF;
    payload[payloadBytes - 1] = 0xFF;

    const auto values = decodePayload(payload);
    assert(values.has_value());
    assert(values->size() == measurementCount);
    assert(values->front() == 0x123456);
    assert((*values)[1] == 0);
    assert(values->back() == 0xFFFFFF);

    assert(!decodePayload(std::vector<std::uint8_t>{}));
    assert(!decodePayload(std::vector<std::uint8_t>(payloadBytes - 1)));
    assert(!decodePayload(std::vector<std::uint8_t>(payloadBytes + 1)));

    std::cout << "Decoded " << values->size() << " measurements\n";
    std::cout << "First: " << values->front() << '\n';
    std::cout << "Last: " << values->back() << '\n';
}
```

Expected output:

```text
Decoded 480 measurements
First: 1193046
Last: 16777215
```

The final loop iteration reads offsets 1437, 1438, and 1439. All are valid because the length check established exactly 1440 elements.

The count is a fixed, small constant here. For a general decoder with an untrusted count, validate multiplication and bounds before computing sizes or offsets.

## Reserve is not resize

The output uses `reserve(480)` followed by `push_back`.

Reserving capacity does not create elements. This would be wrong:

```cpp
std::vector<std::uint32_t> values;
values.reserve(480);
// values[0] = 42; // Invalid: the vector still has size zero.
```

Alternatively, construct or resize the vector to 480 elements, then assign through valid indices.

The same distinction matters at the receive boundary. Make the receiving vector's size cover the writable region before passing it to a socket API. After a successful receive, expose only the bytes actually received to the parser. Handle errors before converting a signed receive result to an unsigned size.

Also detect truncation using the receiving API's documented behavior. A buffer filled to capacity is not, by itself, proof that the complete original datagram had that size.

## Why not reinterpret_cast?

This is not a valid replacement for the decoder:

```cpp
// Do not use this to decode a three-byte field:
// auto value = *reinterpret_cast<const std::uint32_t*>(payload.data());
```

A four-byte load consumes an extra byte. It also introduces alignment and object-access requirements that a byte buffer does not establish, and interprets the bytes using native byte order.

Using `memcpy` into a real integer can avoid alignment and typed-access problems, but it does not decide byte significance for you. Copying three bytes into a zero-initialized integer still depends on the host representation.

Three explicit byte reads and shifts express the format directly.

## Keep transport, decoding, and interpretation separate

The receive layer should establish which bytes arrived and whether the datagram was complete. The decoder should validate the payload shape and produce integer values. A later stage can apply units, calibration, or special invalid-value rules.

For example, decoding `0xFFFFFF` correctly does not prove it is a valid distance. The device specification might reserve it as a sentinel. Keep that protocol decision explicit.

Similarly, this decoder assumes unsigned values. A signed 24-bit field requires signed interpretation after reconstruction. Do not silently treat the top bit as a sign unless the protocol says to.

The algorithm takes linear time in the number of measurements and stores one output integer per measurement. If allocation is costly in a high-rate pipeline, reuse output storage or decode into a fixed-size container. Measure before replacing clear code with wider loads or platform-specific tricks.

## Check your understanding

A big-endian field arrives as:

```text
00 01 02
```

What value does it represent, and does a little-endian host need to swap the decoder's result?

The value is `0 × 65536 + 1 × 256 + 2 = 258`. No additional swap is needed. The decoder already constructed the correct number.

## Takeaways

- A packet is a sequence of protocol bytes, not an array of native integers.
- Reconstruct numeric significance explicitly.
- Widen before shifting.
- Validate lengths before indexing and use the actual receive length.
- Separate decoding from calibration and semantic validation.

## References and verification

- [C++17 working draft N4659: shift operators](https://timsong-cpp.github.io/cppwp/n4659/expr.shift) — C++17 shift rules.
- [Integral promotions](https://eel.is/c++draft/conv.prom) — the arithmetic type may differ from the input byte type.
- [Fixed-width integer types](https://eel.is/c++draft/cstdint.syn) — exact-width type availability.
- [Vector capacity](https://eel.is/c++draft/vector.capacity) — reserve versus size.
- [Object access rules](https://eel.is/c++draft/basic.lval) — why casting a byte buffer is not a general decoding technique.

The current working-draft links evolve; this article targets C++17. The wire format is an explicit example contract, not a claim about all LiDAR devices.

Verification: GCC 13.3.0 with `-std=c++17 -Wall -Wextra -Wconversion -pedantic`. Compile-time checks cover byte significance and boundary values. Runtime assertions cover first and last measurements, zero-filled data, and empty, short, and oversized payloads. The complete program produced the output shown and was also run with AddressSanitizer and UndefinedBehaviorSanitizer enabled. Leak detection was disabled because LeakSanitizer could not inspect processes in the execution environment.
