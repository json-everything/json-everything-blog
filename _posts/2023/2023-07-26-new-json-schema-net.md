---
title: "The New JsonSchema.Net"
date: 2023-08-02 09:00:00 +1200
tags: [json-schema, performance]
toc: true
pin: false
---

Some changes are coming to _JsonSchema.Net_: faster validation and fewer memory allocations thanks to a new keyword architecture.

The best part: unless you've built your own keywords, this probably won't require any changes in your code.

## A new keyword architecture?

For about the past year or so, I've had an idea that I've tried and failed to implement several times: by performing static analysis of a schema, some work can be performed before ever getting an instance to validate.  That work can then be saved and reused across multiple evaluations.

For example, with this schema

```json
{
  "type": "object",
  "properties": {
    "foo": { "type": "string" },
    "bar": { "type": "number" }
  }
}
```

we _know_:

1. that the instance **must** be an object
2. if that object has a `foo` property, its value **must** be a string
3. if that object has a `bar` property, its value **must** be a number

These are the _constraints_ that this schema applies to any instance that it validates.  Each constraint is comprised of an instance location and a requirement for the corresponding value.  What's more, most of the time, we don't need the instance to identify these constraints.

This is the basic idea behind the upcoming _JsonSchema.Net_ v5 release.  If I can capture these constraints and save them, then I only have to perform this analysis once.  After that, it's just applying the constraints to the instance.

## Architecture overview

With the upcoming changes, evaluating an instance against a schema occurs in two phases:  gathering constraints, and processing individual evaluations.

> For the purposes of this post, I'm going to refer to the evaluation of an individual constraint as simply an "evaluation."
{: .prompt-info }

### Collecting constraints

There are two kinds of constraints: schema and keyword.  A schema constraint is basically a collection of keyword constraints, but it also needs to contain some things that are either specific to schemas, such as the schema's base URI, or common to all the local constraints, like the instance location.  A keyword constraint, in turn, will hold the keyword it represents, any sibling keywords it may have dependencies on, schema constraints for any subschemas the keyword defines, and the actual evaluation function.

> I started with just the idea of a generic "constraint" object, but I soon found that the two had very different roles, so it made sense to separate them.  I think this was probably the key distinction from previous attempts that allowed me to finally make this approach work.
{: .prompt-info }

So for constraints we have this recursive definition that really just mirrors the structural definition represented by `JsonSchema` and the different keyword classes.  The primary difference between the constraints and the structural definition is that the constraints are more generic (implemented by two types) and evaluation-focused, whereas the structural definition is the more object-oriented model and is used for serialization and other things.

Building a schema constraint consists of building constraints for all of the keywords that (sub)schema contains.  Each keyword class knows how to build the constraint that should represent it, including getting constraints for subschemas and identifying keyword dependencies.

Once we have the full constraint tree, we can save that in the `JsonSchema` object and reuse that work for each evaluation.

### Evaluation

Each constraint object produces an associated evaluation object.  Again, there are two kinds: one for each kind of constraint.

When constructing a schema evaluation, we need the instance (of course), the evaluation path, and any options to apply during this evaluation.  It's important to recognize that options can change between evaluations; for example, sometimes you may or may not want to validate `format`.  A results object for this subschema will automatically be created.  Creating a schema evaluation will also call on the contained keyword constraints to build their evaluations.

To build a keyword evaluation, the keyword constraint is given the schema constraint that's requesting it, the instance location, and the evaluation path.  From that, it can look at the instance, determine if the evaluation even needs to run (e.g. is there a value at that instance location?), and create an evaluation object if it does.  It will also create schema evaluations for any subschemas.

In this way, we get another tree: one built for evaluating a specific instance.  The structure of this tree may (and often will) differ from the structure of the constraint tree.  For example, when building constraints, we don't know what properties `additionalProperties` will need to cover, so we build a template from which we can later create multiple evaluations: one for each property.  Or maybe `properties` contains a property that doesn't exist in the instance; no evaluation is created because there's nothing to evaluate.

While building constraints only happens once, building evaluations occurs every time `JsonSchema.Evaluate()` is called.

## [And there was much rejoicing](https://www.youtube.com/watch?v=NmPhaG1ud38)

This a lot, and it's a significant departure from the more procedural approach of previous versions.  But I think it's a good change overall because this new design encapsulates forethought and theory present within JSON Schema and uses that to improve performance.

If you find you're in the expectedly small group of users writing your own keywords, I'm also updating the docs, so you'll have some help there.  If you still have questions, feel free to open an issue or you can find me in Slack (link on the repo readme).

I'm also planning a post for the [JSON Schema blog](https://json-schema.org/blog) which looks at a bit more of the theory of JSON Schema static analysis separately from the context of _JsonSchema.Net_, so watch for that as well.
