---
title: "JSON Schema, But It's Async"
date: 2023-06-16 09:00:00 +1200
tags: [json-schema async]
toc: true
pin: false
---
The one thing I don't like about how I've set up _JsonSchema.Net_ is that `SchemaRegistry.Fetch` only supports synchronous methods.  Today, I tried to remedy that.  This post is a review of those prospective changes.

For those who'd like to follow along, take a look at the [commit](https://github.com/gregsdennis/json-everything/commit/a215bea67deef0d113ab684a7ff69538581b2735) that is the fallout of this change.  Just about every line in this diff is a required, direct consequence of just making `SchemaRegistry.Fetch` async.

## What is `SchemaRegistry`?

Before we get into the specific change and why we need it, we need to cover some aspects of dereferencing the URI values of keywords like `$ref`.

The JSON Schema specification states

> ... implementations SHOULD NOT assume they should perform a network operation when they encounter a network-addressable URI.

That means that, to be compliant with the specification, we need some sort of registry to preload any documents that are externally referenced by schemas.  This text addresses the specification's responsibility around the many security concerns that arise as soon as you require implementations to reach out to the network.  By recommending against this activity, the specification avoids those concerns and passes them onto the implementations that, on their own, wish to provide that functionality.

_JsonSchema.Net_ is one of a number of implementations that can be configured to perform these "network operations" when they encounter a URI they don't recognize.  This is acceptable to the specification because it is opt-in.  In _JsonSchema.Net_ this is accomplished using the `SchemaRegistry.Fetch` property.

> By not actually defining a method in the library, I'm passing on those security responsibilities to the user.
{: .prompt-info }

I actually used to use it to run the [test suite](https://github.com/json-schema-org/JSON-Schema-Test-Suite).  Several of the tests reference external documents through a `$ref` value that starts with `http://localhost:1234/`.  The referenced documents, however, are just files stored in a dedicated directory in the suite.  So in my function, I replaced that URI prefix with the directory, loaded the file, and returned the deserialized schema.  Now I just pre-load them all to help the suite run a bit faster.

`SchemaRegistry.Fetch` is declared as an instance property of type `Func<Uri, IBaseDocument?>`.  Really, this acts as a method that fetches documents that haven't been pre-registered.  Declaring it as a property allows the user to define their own method to perform this lookup.  As this function returns an `IBaseDocument?`, it's synchronous.

## Why would we want this to be async?

The way to perform a network operation in .Net is by creating an `HttpClient` and calling one of its methods.  Funnily, though, all of those methods are... async.

One _could_ create a quasi-synchronous method that makes the call and waits for it.

```c#
IBaseDocument? Download(Uri uri)
{
    using var client = new HttpClient();
    var text = client.GetAsStringAsync(uri).Result;

    if (text == null) return null;

    return JsonSchema.FromText(text);
}
```

but that isn't ideal, and, in some contexts, it's actively disallowed.  Attempting to access a task's `.Result` in Blazor Web Assembly throws an `UnsupportedException`, which is why [json-everything.net](https://json-everything.net) doesn't yet support fetching referenced schemas, despite it being online, where fetching such documents automatically might be expected.

So we need the `SchemaRegistry.Fetch` property to support an async method.  We need it to be of type `Func<Uri, Task<IBaseDocument?>>`.  Then our method can look like this

```c#
async Task<IBaseDocument?> Download(Uri uri)
{
    using var client = new HttpClient();
    var text = await client.GetAsStringAsync(uri);

    if (text == null) return null;

    return JsonSchema.FromText(text);
}
```

## Making the change

Changing the type of the property is simple enough.  However this means that everywhere that the function is called now needs to be within an async method... and those methods also need to be within async methods... and so on.  Async propagation is real!

In the end, the following public methods needed to be changed to async:

- `JsonSchema.Evaluate()`
- `IJsonSchemaKeyword.Evaluate()` and all of its implementations, which is every keyword, including the ones in the vocabulary extensions
- `SchemaRegistry.Register()`
- `SchemaRegistry.Get()`
- `IBaseDocument.FindSubschema()`

The list doesn't seem that long like this, but there were a lot of keywords and internal methods.  The main thing that doesn't make this list, though, is the tests.  Oh my god, there were so many changes in the tests!  Even with the vast majority of the over 10,000 tests being part of the JSON Schema Test Suite (which really just has some loading code and a single method), there were still a lot of `.Evaluate()` calls to update.

Another unexpected impact of this change was in the [validating JSON converter](./deserialization-with-schemas/) from a few posts ago.  `JsonConverter`'s methods are synchronous, and I can't change them.  That means I had to use `.Result` inside the `.Read()` method.  _That_ means the converter can't be used in a context where that doesn't work.

## It's ready...

... but it may be a while before this goes in.  All of the tests pass, and I don't see any problems with it, but it's a rather large change.  I'll definitely bump major versions for any of the packages that are affected, which is effectively all of the JSON Schema packages.

I'll continue exploring a bit to see what advantages an async context will bring.  Maybe I can incorporate some parallelism into schema evaluation. We'll see.

But really I want to get some input from users.

- Is this something you'd like to see?
- Does it feel weird at all to have a schema evaluation be async, even if you know you're not making network calls?
- How does this impact your code?

Leave some comments below with your thoughts.
