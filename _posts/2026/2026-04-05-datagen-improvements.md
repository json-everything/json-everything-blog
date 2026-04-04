---
title: "Better Schema-Compatible Data Generation"
date: 2026-02-08 09:00:00 +1200
tags: [project, support]
toc: true
pin: false
---

_JsonSchema.Net.DataGeneration_ has received some significant upgrades.   In this post, I'll go over what's changed, and how you can use this package to enhance your schema development workflow.

## New and improved!

<!-- Replaced Fare with internal regex value generation to significantly improve regex support
Improved conditional support
Added propertyNames support
Increased test coverage to find and fix bugs
Added generation failure error reporting -->

First let's cover the small stuff.

I added a bunch of tests that identified a few bugs, and added support for `propertyNames`.

There is also added support for the `allof`/`if`/`then` pattern [Jason Desrosiers](https://github.com/jdesrosiers) came up with to implement the OpenAPI `discriminator` keyword.  (You can see this pattern in action in Jason's [excellent post](https://json-schema.org/blog/posts/validating-openapi-and-json-schema#validating) on the JSON Schema blog.)

### Regex improvements

In previous versions, generation of strings that matched regular expressions was performed by the [Fare](https://github.com/moodmosaic/Fare) library.  While great, this library does lack some important features specific to this kind of generation.

When building strings that match JSON Schema requirements, different branches of a schema could have different requirements of the same instance.  This means that in order to get Fare to work right, the library has to create composite expressions, and often those composite expressions weren't supported by Fare.

This led me to drop Fare and implement my own regular expression support that can handle the unique requirements I needed.

> While I have been impressed with the latest state of AI coding, I still don't fully trust it.  That said, I will admit that a large part of this new regular expression support was AI-generated, but it is also heavily tested, so I'm confident that it works for the application.  I'm not sure of the limits, though.  If you find them, please open an issue.
{: .prompt-info }

The new implementation incorporates other keywords, like `minLength`, into the regular expression requirements, and even supports anti-requirements, like a `pattern` keyword inside of a `not` keyword.

### Error reporting

I think this is the coolest addition to this library.  When data generation fails, now it tell you why!

The generation results error message is now descriptive of the error that occurred, and there are you properties that give information about where in the problem occurred:

- `Location` gives you where in the instance the generation failed.
- `SchemaLocations` gives you where in the schema the error occured.

Generally a failure to generate data is the result of either a conflict in the schema

```json
{
  "allOf": [
    { "type": "string" },
    { "type": "number" }
  ]
}
```

or a feature just isn't supported.

The nice thing is that they're all reported now.

## Why use data generation?

While there are likely many use cases for data generation, the most helpful application in my mind is testing your schemas.  Being able to see what kinds of data your schemas allow enables you to find gaps that can allow invalid data into your systems.

### A very real failure mode

Say you're building a user registration endpoint.  You write a JSON Schema for the request body, wire it up with _JsonSchema.Api_ to support automatic request validation, and ship it.  The schema looks like this:

```json
{
  "type": "object",
  "properties": {
    "name": { "type": "string" },
    "email": { "type": "string" },
    "age": { "type": "integer" }
  },
  "required": ["name", "email", "age"]
}
```

A client hits the endpoint and passes this:

```json
{
  "name": "",
  "email": "x",
  "age": -5847,
  "password": "hunter2",
  "admin": true
}
```

Schema validation passes and the request comes through into your controller.  But tThat payload has an empty name, an invalid email, a nonsensical age, and extra properties that your endpoint never asked for.  If any of that data gets trusted downstream, you now have a production issue caused by a "valid" request.

The schema is doing what it was told.  The problem is that it doesn't yet express what you meant.

So you go back and tighten things up:

```json
{
  "type": "object",
  "properties": {
    "name": { "type": "string", "minLength": 1 },
    "email": { "type": "string", "format": "email" },
    "age": { "type": "integer", "minimum": 0, "maximum": 150 }
  },
  "required": ["name", "email", "age"],
  "additionalProperties": false
}
```

Now that same request gets rejected immediately.

This is where generation helps.  Instead of trying to invent every weird edge case yourself, you generate samples that are valid for your schema and inspect them.  If the samples include data your API can't safely handle, the schema needs more constraints.

The new error reporting helps here, too.  If you've created conflicting constraints (for example in an `allOf`) and generation can't produce data, it tells you where and why it failed, helping you to identify and resolve the problem.

## Wrapping up

Most of these updates came from real use: writing schemas, finding edge cases, adding tests, and fixing what those tests exposed.

If you're already using this package, updating should give you better output and much better diagnostics when something goes wrong.  If you haven't used it yet, this release is a solid place to start.

_If you aren't generating revenue, you like the work I put out, and you would still like to support the project, please consider [becoming a sponsor](https://github.com/sponsors/gregsdennis)!_