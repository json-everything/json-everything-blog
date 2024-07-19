---
title: "JSON Path Has a New Spec!"
date: 2023-05-02 09:00:00 +1200
tags: [json-path]
toc: true
pin: false
---
IETF are submitting a new RFC to formalize the well-known [JSON Path](https://goessner.net/articles/JsonPath/) query syntax, originally proposed by [Stefan Gössner](https://github.com/goessner) in 2008.

## A brief history

The effort to build a specification started after [Christoph Burgmer](https://github.com/cburgmer) created his amazing [JSON Path Comparison](https://cburgmer.github.io/json-path-comparison/) website, project he started in 2019.  To build it, he gathered all of the implementations he could find, created test harnesses for each of them, and ran them all against a very large and comprehensive set of JSON Path queries that were found to be supported by at least one of the implementations.  The resulting grid revealed that many implementations had their own "flavor" of the original JSON Path by Goëssner.  Some added syntax that wasn't specified, while others merely filled in gaps to the best of their ability.

In 2020, I was invited (along with many other library maintainers) by [Glyn Normington](https://github.com/glyn) to participate in writing an official specification, and soon after, IETF was invoked to manage the spec-writing process.

Since then, we have been working to solidify a syntax that can be implemented on any platform, in any language, and provide consistent results.

## The charter

The idea behind writing the specification was to provide common ground that the implementations, which at this point vary considerably from each other, can all aim for.  In this way, there would be at least a minimal level of interoperability or guaranteed support.  As long as a user wrote a JSON Path query that only used features in the specification, it would be supported by whatever implementation they were using.

The other thing the charter wanted to ensure was minimal breakage of existing support.  We wanted to make sure that we were supporting existing queries as much as possible.

## Similarities

I think that we covered the basics, and for the most part, it's largely the same as what's in Goëssner's post:

- bracketed syntax for everything
- dot syntax for friendly names (`.foo`) and wildcards (`.*`)
- select by
  - object key name
  - array index (negative selects from end)
  - array index slice (`1:10:2` to select indices 1, 3, 5, 7 and 9)
  - wildcard (all children)
  - expression
- double-dot syntax to make any query recursive
- use single- or double-quotes

This should support most users' needs.

Once parsed (meaning the syntax is valid) an implementation must not error.  That means if, for example, a comparison doesn't make sense (e.g. an array being less than a number), the result is just false, and the node isn't selected.  This feature wasn't stated in Goëssner's post, but it seemed reasonable to include.

Finally, the return value is what we call a "nodelist."  A node is a tuple that consists of a value that is present in the JSON data as well as its location within that data.  Duplicate nodes (same value and location) may appear in nodelists if they're selected by different parts of the path.

## Additions

In addition to the above, some features from other implementations did make it into the specification.

Multiple selectors within a bracketed syntax:

```json-path
$['foo','bar']
```

You can even mix and match selectors:

```json-path
$['foo',42,1:10:2]
```

Parentheses are no longer needed for filter expressions:

```json-path
$[?@.foo==42]
```

## Omissions

Currently, math operators aren't supported by the specification (though I encouraged the group to add them).

```json-path
// find items where the difference between .foo and .bar is 42
$[?@.foo-@.bar==42]
```

Although it wasn't supported by Goëssner's post, starting the overall JSON Path with `@`, which does seem to be supported by a considerable number of implementations, was decided against.

```json-path
@.foo
```

Only JSON primitives are allowed in filter expressions, so explicit objects and arrays are not permitted.

```json-path
$[?@.foo==["string",42,false]]
```

The `in` operator was excluded.  This one isn't quite as common, but several of the larger implementations do support it, so I figured it was worth mentioning.

```json-path
$[?@.foo in [1,2,3,4,"string"]] // also requires structured values

$[?42 in @.foo]
```

> All of the above are supported in _JsonPath.Net_ via the `PathParsingOptions` object.
{: .prompt-tip }

What I came to call "container queries" are also not supported.  These are expression queries where, instead of evaluating to a boolean, the expression would evaluate to the index or key to select.  The team just couldn't find a compelling use case for them, though I did propose a couple niche use cases.

```json-path
// can be written as $[-1]
$[(@.length-1)]

// can't be otherwise expressed
$[@.discriminator] // for an object like {"discriminator": "foo", "foo": "bar"}
```

`.length` to determine the length of an array is not supported.  It's featured in Goëssner's post, and just about every implementation supports it.  However, it creates an ambiguity with trying to select `length` properties in data.

Most of the time with existing implementations, the workaround for selecting a `length` property is to use the bracket syntax, `['length']`.  This indicated that you wanted the value of that property rather than the number of items that the data contained.  However the team felt that it was better not to have special cases.

The functionality, however was restored as the `length()` function.  Although it _is_ a different syntax (which we'll come to), and `.length` will no longer be supported as generally expected.

## Filter expressions

I think the biggest difference is in how filter expressions (`?@.foo==42`) are supported.

Goëssner's post says that the filter expressions should use the underlying language engine.  Doing this is easier to specify, and it's easier to implement.  However it's not at all interoperable.  If I need to send a JSON Path to some server, I shouldn't need to know that, if the server is written in Python, I need to write my filter expression in Python.  If I want to send that same query to another server that's written in another language, I have to write a new path for that server that attempts to do the same thing.  (There are also security implications of receiving code to be executed.)

The only way to resolve this is to specify the filter expression syntax: a common syntax that can be implemented using any language.

### Based on well-known syntax

Most developers should be used to the C-style operators, `&&` and `==`, etc.

The order of operations should be familiar as well: `||`, `&&`, `!`, then comparisons.

Also, both single- and double-quoted strings are permitted.

### Functions

Yes!  JSON Path now supports functions in filter expressions.  These were introduced partially to support the `.length` functionality, but also as a general extension mechanism.

So instead of

```json-path
$[?@.foo.length>42]
```

you'd use

```json-path
$[?length(@.foo)>42]
```

There are four other functions defined by the specification:

- `count(<path>)` will return the number of results from a sub-query
- `match(<string>, <regex>)` will exact-match a string against a regular expression (implicit anchoring)
- `search(<string>, <regex>)` will contains-match a string against a regular expression
- `value(<path>)` will return the value of a query that only returns a single result

Every function must declare a "type" for its return value and its parameters.  If the function is written so that these types are not correct, the specification requires that the parse will fail.

There are three types:

- `ValueType` - any JSON value and `Nothing`, which is akin to `undefined` in Javascript
- `LogicalType` - either `LogicalTrue` or `LogicalFalse`; think of it like the result of a comparison.  It's distinct from JSON's `true` and `false` literals.
- `NodesType` - the return of a query.

> Technically, the well-typedness of functions is determined during a semantic analysis step that occurs after the parse, but _JsonPath.Net_ does both the parse and the semantic analysis at the same time, so in my head it's all just "parsing."  You give it a string, and it gives you a path... or errors.
{: .prompt-info}

### Extending JSON Path

Lastly, IETF will be maintaining a function registry where new functions can be defined for all implementations to use.  The five functions in the spec document (listed above) will be required, and the registry functions will be recommended.  You'll need to check with the implementation to see what it supports.  I plan on supporting everything in _JsonPath.Net_.

## In summary

That's pretty much the spec.  There are a few changes that are incompatible with what is understood by many implementations, but I think what we have should be supportable by everyone.

If you'd like to join in on the fun, have a look at the [GitHub repo](https://github.com/ietf-wg-jsonpath/draft-ietf-jsonpath-base) where we're writing the spec and join the [IETF mailing list](https://www.ietf.org/mailman/listinfo/jsonpath) for the project.

I hope that we continue this effort to further [define and enhance](https://github.com/ietf-wg-jsonpath/draft-ietf-jsonpath-base/issues?q=label%3Arevisit-after-base-done+) JSON Path.

_If you like the work I put out, and would like to help ensure that I keep it up, please consider [becoming a sponsor](https://github.com/sponsors/gregsdennis)!_
