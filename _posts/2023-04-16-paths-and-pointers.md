---
title: "JSON Path vs JSON Pointer"
date: 2023-04-16 09:00:00 +1200
tags: [json-path, json-pointer]
toc: true
pin: false
---

JSON Path and JSON Pointer are two different syntaxes that serve two different purposes.

- JSON Path is a query syntax that's used to search JSON data for values that meet specified criteria.
- JSON Pointer is an indicator syntax that's used to specify a single location within JSON data.

They both have their own strengths and knowing which to employ for a given use case can be important.  I'm not going to dive too deeply into the syntaxes of each in this post, but I'll give enough of an overview to lay the foundation to explain their differences.

## JSON Pointer

A JSON Pointer is constructed with a series of selectors separated by forward slashes `/`.  The selectors can be either key names or array indices.

A JSON Pointer's purpose is to identify a single location within JSON data.

However, the specific location can depend on the shape of the data that it's given.  To see this, let's take a look at an example.

```json-pointer
/foo/2/bar
```

Reading this pointer, you would probably guess the following:

- `foo` is an object key
- `2` is an array index
- `bar` is an object key

At first glance, it's obvious that `foo` and `bar` can only be object keys because they are non-numeric.  Surprisingly, however, `2` can either be an array index _or_ an object key.  The _data_ makes that determination when it's evaluated.

If the pointer finds an array when evaluating the `2` segment, then the segment is treated like a number and the third (0-based indexing) element in the array is selected (if it exists).  However, if the pointer finds an object when evaluating the `2`, the segment is treated like a key name, and the object is searched for a `"2"` key.

Importantly, given some JSON data, a pointer only identifies at most a single location within it.

## JSON Path

A JSON Path is a query that operates over JSON data.  Like JSON Pointer, it's constructed using a series of segments, but there are more types of segments, most of which can select multiple values.

A JSON Path's purpose is generally to find _all values_ within JSON data that meet given criteria.  The syntax supports identifying a single location, but that's not its purpose.

Many implementations of JSON Path not only return the values, but also the locations of those values within the original data.  Often that location is also expressed as a JSON Path.

> It could be argued that a JSON Pointer would be better suited to indicate the single location of a specific value found by a JSON Path, but then users would have to contend with two syntaxes, so JSON Path is generally used for the location indicator.
{: .prompt-info }

## Converting between the syntaxes

Let's start with the obvious:  JSON Path to JSON Pointer.

> A JSON Path can be expressed as a JSON Pointer only when each of its segments can select at most a single node.
{: .prompt-info}

```json-path
$.foo..bar
```

The JSON Path above will start with the root's `foo` property and then recursively search the result for any values that are under `bar` properties.  Since this returns multiple values, it can't be represented as a JSON Pointer.

```json-path
$.foo[2].bar
```

This JSON Path has three segments that each identify a single value.  Its JSON Pointer representation is the example we had earlier in the post: `/foo/2/bar`.

But remember that for this JSON Pointer, the `2` _could_ potentially select a `"2"` key in an object.  But the `[2]` in the JSON Path can only select from an array.  It would need to be `['2']` to select from an object... but then it couldn't select from an array. Therefore,

> A JSON Pointer can be expressed as a JSON Path only when all of its segments are non-numeric keys.
{: .prompt-info}

`/foo/bar` is equivalent to `$.foo.bar`, however, in general, JSON Paths and JSON Pointers are not interchangeable.

## When do I use which?

Whether you use JSON Path or JSON Pointer depends heavily on what you expect to get back.

- If you only expect (or can only handle) at most single value being returned, use JSON Pointer.
- If you are okay with receiving multiple results, then JSON Path is probably your friend.

[JSON Schema](https://json-schema.org/understanding-json-schema/structuring.html#ref)'s `$ref` keyword uses URI-encoded JSON Pointers because only a single value is expected (specifically, a value that can be interpreted as a schema).

[Kubernetes](https://kubernetes.io/docs/reference/kubectl/jsonpath/) generally expects multiple results, so it uses its own custom flavor of JSON Path.

## The verdict

While some JSON Pointers and JSON Paths _can_ indicate the same locations, this is not the case in general.  Use the right one for your scenario.

I think a lot of confusion on this topic arises because many APIs get this decision wrong.  I've seen many APIs that define a parameter that accepts JSON Path but whose evaluation must only result a single value.  I figure they think more people are familiar with JSON Path (maybe because of the dot syntax) so they choose to use it for the API.  But perhaps familiarity isn't a sufficient reason to use a tool.
