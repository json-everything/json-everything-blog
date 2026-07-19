---
title: "All the Error Messages"
date: 2026-07-19 09:00:00 +1200
tags: [json schema, errors, output]
toc: true
pin: false
---

The latest iteration of _JsonSchema.Net_, version 9.3.0, adds error messages to the output for all keywords that act as assertions.  In this post I'd like to go into why they didn't include these error messages before and why they absolutely should now.

## Error reporting in JSON Schema

In the long-long-ago, there was no standardized output for JSON Schema.  Implementations of JSON Schema could output whatever they wanted as long as there was a validation result, and most of the time, implementations only gave that: a simple true or false indicating whether the instance conformed to the requirements in the schema.  Some implementations would provide extended output in the form of error messages, generally as string arrays, but this was a fairly uncommon practice.

When 2019-09 rolled around, a GitHub issue had been created requesting the possibility of including a prescribed output format.  It was a great idea, and after much conversation, we landed on a format that was structured based on the schema and included a node for every keyword validation.

There were ways to pare down the result tree to make it easier to parse out what was really wrong, but the base format was set.  It looked something like this:

```json
{
  "$schema": "https://json-schema.org/draft/2019-09/schema",
  "$id": "https://blog.json-everything.net/errors",
  "type": "object",
  "properties": {
    "validProp": { "type": "number" },
  },
  "additionalProperties": { "type": "boolean" }
}
```
{: file="schema"}

```json
{
  "validProp": 5,
  "disallowedProp": "value"
}
```
{: file="instance"}

```json
{
  "valid": false,
  "keywordLocation": "#",
  "instanceLocation": "#",
  "errors": [
    {
      "valid": true,
      "keywordLocation": "#/type",
      "instanceLocation": "#"
    },
    {
      "valid": true,
      "keywordLocation": "#/properties",
      "instanceLocation": "#"
    },
    {
      "valid": false,
      "keywordLocation": "#/additionalProperties",
      "instanceLocation": "#",
      "errors": [
        {
          "valid": false,
          "keywordLocation": "#/additionalProperties/type",
          "instanceLocation": "#/disallowedProp",
          "error": "Value is \"string\" but should be \"boolean\""
        }
      ]
    }
  ]
}
```
{: file="output 2019-09"}

As you can imagine, this gets very verbose as the schema grows even a little.  To address this, we took another look at the output for the next iteration of JSON Schema.  (You can read more about developing the new format in [this post](https://json-schema.org/blog/posts/fixing-json-schema-output) on the JSON Schema blog.)  The above validation would look like this:

```json
{
  "valid": false,
  "evaluationPath": "",
  "schemaLocation": "https://blog.json-everything.net/errors#",
  "instanceLocation": "",
  "details": [
    {
      "valid": true,
      "evaluationPath": "/properties/validProp",
      "schemaLocation": "https://blog.json-everything.net/errors#/properties/validProp",
      "instanceLocation": "/validProp"
    },
    {
      "valid": false,
      "evaluationPath": "/additionalProperties",
      "schemaLocation": "https://blog.json-everything.net/errors#/additionalProperties",
      "instanceLocation": "/disallowedProp",
      "errors": {
        "type": "Value is \"string\" but should be \"boolean\""
      }
    }
  ]
}
```
{: file="output v1"}

The key things to notice is the change in organisational structure: instead of having a node per keyword, we now have a node per subschema.  And this brings us to the critical point.

## Omitting some error messages

When an output node represented a keyword, it was very easy to identify which keyword was causing a validation failure.  It was right there in the output under `keywordLocation`.

So we don't need a separate error message for keywords like `allOf` or `not`, like in this schema:

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$id": "https://blog.json-everything.net/errors-2",
  "type": "object",
  "properties": {
    "value": {
      "type": "number",
      "not": { "const": 0 }
    }
  }
}
```

If `value` was 0, it was very easy to see from the output that the `not` keyword failed when its subchema passed because you had a node just for `not`.  Including an explicit error message for `not` just wasn't necessary and actually cause an already verbose output to become even more verbose.

So with this output format, there was a legitimate reason to omit some of the error messages.

## Carrying that decision forward

When we redesigned the output format for JSON Schema v1, I updated _JsonSchema.Net_ to follow suit.  But it didn't occur to me that the decision to omit error messages for some keywords might not be the right decision for this new format.

For example, as reported in [#1050](https://github.com/json-everything/json-everything/issues/1050),

```json
{
  "valid": false,
  "evaluationPath": "",
  "schemaLocation": "https://blog.json-everything.net/errors-2#",
  "instanceLocation": "",
  "details": [
    {
      "valid": false,
      "evaluationPath": "/properties/value",
      "schemaLocation": "https://blog.json-everything.net/errors-2#/properties/value",
      "instanceLocation": "/value",
      "details": [
        {
          "valid": true,
          "evaluationPath": "/properties/value/not",
          "schemaLocation": "https://blog.json-everything.net/errors-2#/properties/value/not/value",
          "instanceLocation": "/value"
        }
      ]
    }
  ]
}
```

it's considerably more difficult to understand what exactly cause the failed validation.

You can see that the subschema at `/properties/value/not` passed validation, and its parent failed, but looking at the node for `/properties/value` it's not as obvious that the `not` is the cause of the failure.  You can get it, but you have to stare at it for a while.

## Simplicity is best

The easiest route to solving this problem is just to add error messages to all of the keywords, so that's what v9.3.0 does.  And after thinking through the above reasoning, it made more sense why all of the keywords that assert should produce error messages.

```json
{
  "valid": false,
  "evaluationPath": "",
  "schemaLocation": "https://blog.json-everything.net/errors-2#",
  "instanceLocation": "",
  "errors": {
    "properties": "Some properties did not match the required schema"
  },
  "details": [
    {
      "valid": false,
      "evaluationPath": "/properties/value",
      "schemaLocation": "https://blog.json-everything.net/errors-2#/properties/value",
      "instanceLocation": "/value",
      "errors": {
        "not": "The subschema passed evaluation but was expected to fail"
      },
      "details": [
        {
          "valid": true,
          "evaluationPath": "/properties/value/not",
          "schemaLocation": "https://blog.json-everything.net/errors-2#/properties/value/not/value",
          "instanceLocation": "/value"
        }
      ]
    }
  ]
}
```

In the end it came down to this: when a keyword causes a subschema to fail validation, there should be a reason why.  In the case above, `not` caused its subschema to fail, but there's no `not` error.  Having that error explicitly stated with the `not` keyword as its producer makes all the difference.

It could be argued that it could be inferred given the presence of the detail node and its `evaluationPath`, but I think there's something to be said about ease of use.  A little bit more information, like an error message, goes a long way to diagnosing what went wrong with the validation.

_If you aren't generating revenue, you like the work I put out, and you would still like to support the project, please consider [becoming a sponsor](https://github.com/sponsors/gregsdennis)!_