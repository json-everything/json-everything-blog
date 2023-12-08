---
title: "Why I'm Updating My JSON Schema Vocabularies"
date: 2023-12-08 09:00:00 +1200
tags: [json-schema, vocab, vocabulary]
toc: true
pin: false
---

Both of the vocabularies defined by `json-everything` are getting a facelift.

- The data vocabulary is getting some new functionality.
- The UniqueKeys vocabulary is being deprecated in favor of the new Array Extensions vocabulary.

I'm also doing a bit of reorganization with the meta-schemas, which I'll get into.

## Data vocabulary updates

The data vocabulary is actually in its second version already.  I don't keep a link to the first version on the documentation site, but the [file](https://github.com/gregsdennis/json-everything-docs/blob/main/_docs/schema/vocabs/data.md) is still in the GitHub repo.

The second version (2022) clarified some things around how URIs were supposed to be resolved, improved how different data sources could be referenced more explicitly, and added support for Relative JSON Pointers.  Most importantly, it disallowed the use of Core vocabulary keywords, which had previously allowed the formed schema to behave differently from its host, introducing some security risks.

This [new version](https://docs.json-everything.net/schema/vocabs/data-2023/) (2023) merely builds on the 2022 version by adding:

- the `optionalData` keyword, which functions the same as `data` except that if a reference fails to resolve that keyword is ignored rather than validation halting.
- JSON Path references, which can collect data spread over multiple locations within the instance.  I think this is really powerful; there's an example in the spec.

## Introducing the Array Extensions vocabulary

The `uniqueKeys` keyword needed some updates anyway.  It was the first vocabulary extension I wrote, and some of the language updates that I made to the data vocabulary in its second edition never made it over here.  But I didn't just want update language or URIs; I wanted a functional change.

However, the keyword itself doesn't really need to be changed.  I think it's good as it is.  So instead, I'm adding a new keyword, which means it can't just be the "unique keys" vocabulary anymore.  It needs a new name that better reflects all of the defined functionality.

So I'm deprecating it and replacing it with the new [Array Extensions vocabulary](https://docs.json-everything.net/schema/vocabs/array-ext/), which does two things:

- cleans up some language around `uniqueKeys` without changing the functionality.
- adds the `ordering` keyword to validate that items in an array are in an increasing or decreasing sequence based on one or more values within each item.

## Meta-schema rework

I've recently had a few discussions ([here](https://github.com/orgs/json-schema-org/discussions/510) and [here](https://github.com/orgs/json-schema-org/discussions/511)) with some JSON Schema colleagues regarding the "proper" way to make a meta-schema for a vocabulary, and it seems my original approach was a little shortsighted.

When I created my meta-schemas, I simply created a 2020-12 extension meta-schema.  It's straight-forward and gets the job done, but it's not very useful if you want to extend 2020-12 with multiple vocabularies, e.g. if you want to use both Data and UniqueKeys.

```jsonc
{
  "$id": "https://json-everything.net/meta/data-2022",
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$vocabulary": {
    // <core vocabs>
    "https://json-everything.net/vocabs-data-2022": true
  },
  "$dynamicAnchor": "meta",
  "title": "Referenced data meta-schema",
  "allOf": [
    // reference the 2020-12 meta-schema
    { "$ref": "https://json-schema.org/draft/2020-12/schema" }
  ],
  "properties": {
    "data": {
      // data keyword definition
    },
    "optionalData": {
      // optionalData keyword definition (it's the same as data)
    }
  }
}
```

This isn't _wrong_, but it could be done better.

Instead of having a single meta-schema that both validate the keyword and extends 2020-12 to use the vocabulary, we separate those purposes.  (Feels a lot like SRP to me.)

So now we have a vocabulary meta-schema, which only serves to validate that the keyword values are syntactically correct, and a separate draft meta-schema extension which references it.

The new Data vocabulary meta-schema look like this:

```jsonc
{
  "$id": "https://json-everything.net/schema/meta/vocab/data-2023",
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$defs": {
    "formedSchema": {
      // data keyword definition
    }
  },
  "title": "Referenced data meta-schema",
  "properties": {
    "data": { "$ref": "#/$defs/formedSchema" },
    "optionalData": { "$ref": "#/$defs/formedSchema" }
  }
}
```

The `$vocabulary`, `$dynamicAnchor`, and reference to the 2020-12 meta-schema have all been removed as they're not necessary to validate the syntax of the vocabulary's keywords.

And the new Data 2020-12 extension meta-schema is this:

```jsonc
{
  "$id": "https://json-everything.net/schema/meta/data-2023",
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$vocabulary": {
    // <core vocabs>
    "https://docs.json-everything.net/schema/vocabs/data-2023": true
  },
  "$dynamicAnchor": "meta",
  "title": "Data 2020-12 meta-schema",
  "allOf": [
    { "$ref": "https://json-schema.org/draft/2020-12/schema" },
    { "$ref": "https://json-everything.net/schema/meta/vocab/data-2023" }
  ]
}
```

The keyword definition is removed and the vocab meta-schema is referenced.  [That's how the 2020-12 meta-schemas did it](https://www.youtube.com/watch?v=9UzxfhRznpU), and it's much more reusable this way.

> The Array Extensions vocabulary meta-schemas are also built this new way.
{: .prompt-info}

Now, if you want to create a 2020-12 meta-schema that also includes the new Array Extensions vocabulary, you can take the above, change the `$id`, and add a reference to the Array Vocabulary meta-schema.  This approach allows schema authors to more easily mix and match vocabularies as they need for their application.

## I need validation

The new vocabularies are still a work-in-progress, but they're mostly complete for these versions.  I don't think the Data vocabulary will evolve much more, but I do hope to continue adding to the Array Extensions vocabulary as new functionality is conceived and requested.  (There's actually a really neat [concept](https://github.com/json-schema-org/json-schema-spec/issues/1323) from Austin Wright, one of the spec authors, regarding patterned item sequence validation.)

Questions and comments are welcome in the `json-everything` Github repository, or leave a comment down below.
