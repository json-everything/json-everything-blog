---
title: "Exploring Code Generation with JsonSchema.Net.CodeGeneration"
date: 2023-10-02 09:00:00 +1200
tags: [json-schema, codegen]
toc: true
pin: false
---

About a month ago, my first foray into the world of code generation was published with the extension library JsonSchema.Net.CodeGeneration.  For this post, I'd like to dive into the process a little to show how it works.  Hopefully, this will give better insight on how to use it as well.

This library currently serves as an exploration platform for the [JSON Scheam IDL Vocab](https://github.com/json-schema-org/vocab-idl/issues/47) work, which aims to create a new vocabulary designed to help support translating between code and schemas (both ways).

## Extracting type information

The first step in the code generation process is determining what the schema is trying to model.  This library uses a complex set of mini-meta-schemas to identify supported patterns.

> A meta-schema is just a schema that validates another schema.
{: .prompt-tip }

For example, [in most languages](https://github.com/json-schema-org/vocab-idl/issues/43), enumerations are basically just named constants.  The ideal JSON Schema representation of this would be a schema with an `enum`.  So .Net's `System.DayOfWeek` enum could be modelled like this:

```json
{ 
  "title": "DayOfWeek",
  "enum": [ "Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday" ]
}
```

To identify this schema as defining an enumeration, we'd need a meta-schema that looks like this:

```json
{
  "type": "object",
  "title": "MyEnum",
  "properties": {
    "enum": {
      "type": "array"
    }
  },
  "required": [ "enum" ]
}
```

However, in JSON Schema, an `enum` item can be _any_ JSON value, whereas most languages require strings.  So, we also want to ensure that the values of that `enum` are strings.

```json
{
  "type": "object",
  "title": "MyEnum",
  "properties": {
    "enum": {
      "items": { "type": "string" }
    }
  },
  "required": [ "enum" ]
}
```

> We don't need to include `type` or `uniqueItems` because we know the data is a schema, and its meta-schema (e.g. Draft 2020-12) already has those constraints.  We only need to define constraints _on top of_ what the schema's meta-schema defines.
{: .prompt-info }

Now that we have the idea, we can expand this by defining mini-meta-schemas for all of the patterns we want to support.  There are some that are pretty easy, only needing the `type` keyword:

- string
- number
- integer
- boolean

And there are some that are a bit more complex:

- arrays
- dictionaries
- custom objects (inheritable and non-inheritable)

And we also want to be able to handle references.

The actual schemas that were used are listed in the [docs](https://docs.json-everything.net/schema/codegen/mini-meta-schemas/).  As with any documentation, I hope to keep these up-to-date, but short of that, you can always look at the [source](https://github.com/gregsdennis/json-everything/blob/master/JsonSchema.CodeGeneration/Model/ModelGenerator.cs).

## Building type models

Now that we have the different kinds of schemas that we want to support, we need to represent them in a sort of type model from which we can generate code.

The idea behind the library was to be able to generate multiple code writers that could support just about any language, so .Net's type system (i.e. `System.Type`) isn't quite the right model.

The type model as it stands has the following:

- `TypeModel` - Serves as a base class for the others while also supporting our simple types.  This basically just exposes a type name property.
- `EnumModel` - Each value has a name and an integer value derived from the item's index.
- `ArrayModel` - Exposes a property to track the item type.
- `DictionaryModel` - Exposes properties to track key and item types.
- `ObjectModel` - Handles both open and closed varieties.  Each property has a name, a type, and whether it can read/write.

Whenever we encounter a subschema or a reference, that represents a new type for us to generate.

Lastly, in order to avoid duplication, we set up some equality for type models.

With this all of the types supported by this library can be modelled.  As more patterns are identified, this modelling system can be expanded as needed.

## Writing code

The final step for code generation is the part everyone cares about: actually writing code.

The library defines `ICodeWriter` which exposes two methods:

- `TransformName()` - Takes a JSON string and transforms it into a language-compatible nme.
- `Write()` - Renders a type model into a type declaration in the language.

There's really quite a bit of freedom in how this is implemented.  The [built-in C# writer](https://github.com/gregsdennis/json-everything/blob/master/JsonSchema.CodeGeneration/Language/CSharpCodeWriter.cs) branches on the different model types and has private methods to handle each one.

One aspect to writing types that I hadn't thought about when I started writing the library was that there's a difference between writing the usage of a type and writing the declaration of a type.  Before, when I thought about code generation, I typically thought it was about writing type declarations: you have a schema, and you generate a class for it.  But what I found was that if the properties of an object also use any of the generated types, only the type name needs to be written.

For example, for the `DayOfWeek` enumeration we discussed before, the declaration is

```c#
public enum DayOfWeek
{
    Sunday,
    Monday,
    Tuesday,
    Wednesday,
    Thursday,
    Friday,
    Saturday
}
```

But if I have an array of them, I need to generate `DayOfWeek[]`, which only really needs the type name.  So my writer needs to be smart enough to write the declaration once and write just the name any time it's used.

There are a couple of other little nuance behaviors that I added in, and I encourage you to read the [docs](https://docs.json-everything.net/schema/codegen/schema-codegen/) on the capabilities.

## Generating a conclusion

Overall, writing this was an enjoyable experience.  I found a simple architecture that seems to work well and is also extensible.

My hope is that this library will help inform the IDL Vocab effort back in JSON Schema Land.  It's useful having a place to test things.

_If you like the work I put out, and would like to help ensure that I keep it up, please consider [becoming a sponsor](https://github.com/sponsors/gregsdennis)!_
