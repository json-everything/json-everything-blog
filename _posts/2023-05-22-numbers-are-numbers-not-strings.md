---
title: "Numbers Are Numbers, Not Strings"
date: 2023-05-22 09:00:00 +1200
tags: [json, numbers, strings, encoding, opinion]
toc: true
pin: false
---

A common practice when serializing to JSON is to encode floating point numbers as strings.  This is done any time high precision is required, such as in the financial or scientific sectors.  This approach is designed to overcome a flaw in many JSON parsers across multiple platforms, and, in my opinion, it's an anti-pattern.

## Numbers in JSON

The JSON specification (the latest being [RFC 8259](https://www.rfc-editor.org/rfc/rfc8259) as of this writing) does not place limits on the size or precision of numbers encoded into the format.  Nor does it distinguish between integers or floating point.

That means that if you were to encode the first million digits of _π_ as a JSON number, that precision would be preserved.

Similarly, if you were to encode `85070591730234615847396907784232501249`, the square of the 64-bit integer limit, it would also be preserved.

They are preserved because JSON, by its nature as a text format, encodes numeric values as decimal strings.  The trouble starts when you try to get those numbers out via parsing.

It should also be noted that the specification _does_ have a [couple paragraphs](https://www.rfc-editor.org/rfc/rfc8259#section-6) regarding support for large and high-precision numbers, but that does not negate the "purity" of the format.

> This specification allows implementations to set limits on the range and precision of numbers accepted.  Since software that implements IEEE 754 binary64 (double precision) numbers [IEEE754] is generally available and widely used, good interoperability can be achieved by implementations that expect no more precision or range than these provide, in the sense that implementations will approximate JSON numbers within the expected precision.  A JSON number such as 1E400 or 3.141592653589793238462643383279 may indicate potential interoperability problems, since it suggests that the software that created it expects receiving software to have greater capabilities for numeric magnitude and precision than is widely available.
>
> Note that when such software is used, numbers that are integers andare in the range [-(2\*\*53)+1, (2\*\*53)-1] are interoperable in the sense that implementations will agree exactly on their numeric values.

## The problem with parsers

Mostly, parsers are pretty good, except when it comes to numbers.

An informal, ad-hoc survey conducted by the engineers at a former employer of mine found that the vast majority of parsers in various languages automatically parse numbers into their corresponding double-precision (IEEE754) floating point representation.  If the user of that parsed data wants the value in a more precise data type (e.g. a `decimal` or `bigint`), that floating point value is converted into the requested type _afterward_.

But at that point, all of the precision stored in the JSON has already been lost!

In order to properly get these types out of the JSON, they must be parsed directly from the text.

## My sad attempt at repeating the survey

- [Perl](https://metacpan.org/dist/JSON-Parse/view/lib/JSON/Parse.pod#JSON-numbers) will at least give you the JSON text for the number if it can't parse the number into a common numeric type.  This lets the consumer handle those cases.
  > JSON numbers become Perl numbers, either integers or double-precision floating point numbers, or possibly strings containing the number if parsing of a number by the usual methods fails somehow.
- [Javascript](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/JSON/parse#the_reviver_parameter) actually _recommends_ the anti-pattern for high-precision needs.
  > ... numbers in JSON text will have already been converted to JavaScript numbers, and may lose precision in the process. To transfer large numbers without loss of precision, serialize them as strings, and revive them to BigInts, or other appropriate arbitrary precision formats.
- Go (I <s>played</s> researched [online](https://go.dev/play/p/usCx_5oESBd)) parses a `bigint` number as floating point and truncates high-precision decimals.  There's even an [alternative parser](https://github.com/buger/jsonparser#getboolean-getint-and-getfloat) that behaves the same way.
- [Ruby](https://ruby-doc.org/stdlib-3.0.1/libdoc/json/rdoc/JSON.html#module-JSON-label-Parsing+JSON+Scalars) only supports integers and floating point numbers.
- [PHP](https://www.php.net/manual/en/function.json-decode.php) (search for "Example #5 json_decode() of large integers") appears to operate similarly to Perl in that it can give output as a string for the consumer to deal with.
- [.Net](https://github.com/dotnet/runtime/blob/72fb58b3dfd4f9a40d5f3b0f87e26d9f24136570/src/libraries/System.Text.Json/src/System/Text/Json/Document/JsonDocument.cs#L609-L629) actually stores the tokenized value (`_parsedData`) and then parses it upon request.  So when you ask for a `decimal` (via `.GetDecimal()`) it actually parses that data type from the source text and gives you what you want.  _10pts for .Net!_

> This is why _JsonSchema.Net_ uses `decimal` for all non-integer numbers.  While there is a small sacrifice on range, you get higher precision, which is often more important.
{: .prompt-info }

It appears that many languages support dynamically returning an appropriate data type based on what's in the JSON text (integer vs floating point), which is neat, but then they only go half-way: they only support basic integer and floating point types without any support for high-precision values.

## Developers invent a workaround

As is always the case, the developers who use these parsers need to have a solution, and they don't want to have to build their own parser to get the functionality they need.  So what do they do?  They create a convention where numbers are serialized as JSON strings any time high precision is required.  This way the parser gives them a string, and they can parse that back into a number of the appropriate type however they want.

However, this has led to a multitude of support requests and StackOverflow questions.

- How do I configure the serializer to read string-encoded numbers?
- How do I validate string-encoded numbers?
- When is it appropriate or unnecessary to serialize numbers as strings?

And, as we saw with the Javascript documentation, this practice is actually being _recommended_ now!

This is wrong!  Serializing numbers as strings is a workaround that came about because parsers don't do something they should.

> On the validation question, JSON Schema can't apply numeric constraints to numbers that are encoded into JSON strings.  They need to be JSON numbers for keywords like `minimum` and `multipleOf` to work.
{: .prompt-tip }

## Where to go from here

Root-cause analysis gives us the answer:  the parsers need to be fixed.  They should support extracting any numeric type we want _from JSON numbers_ and at any precision.

A tool should make a job easier.  However, in this case, we're trying to drive a screw with a pair of pliers.  It works, but it's not what was intended.
