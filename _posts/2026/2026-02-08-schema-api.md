---
title: "JsonSchema.Net.Api - JSON Schema Request Validation for ASP.Net"
date: 2026-02-08 09:00:00 +1200
tags: [.net, json-schema, api, asp.net, serialization]
toc: true
pin: false
excerpt: Learn how you can build JSON Schema model validation directly into your ASP.Net pipelines!
---

In a [previous post](/posts/json-schema-aspdotnet), I talked about using JSON Schema validation in the ASP.Net pipeline.  It utilizes schema generation, model binding, and filters to automatically validate controller payloads and return a 400 (Bad Request) with a [problem details](https://datatracker.ietf.org/doc/html/rfc7807) response.

Now, that functionality is available to you as _JsonSchema.Net.Api_!  In this post we'll cover how to set up this package and what it does.

## Why?

For me, there are two purposes in having JSON Schema validation built into the API in this way.

First, it blocks the program flow from even entering the controllers if the request body is bad.  This cleans up the code so much because you don't need validation logic, you don't have to check model state, and you don't have to explicitly return 400.

Second, it serves your consumers by providing valuable information as to what's wrong with their request.  So many APIs simply return 400 without saying _why_ the request was bad.  This is an extremely frustrating experience.  The errors we return in the problem details payload provides exactly identifies the problems.  The caller can fix those problems and get to a valid request faster.

Another benefit I've found is more around API design: because you need to add an attribute to your models in order for it to work (more on that below), it reinforces the common practice of using a custom top-level object for your request model instead of, for example, an array or a string.

## Setup

To add JSON Schema validation to the pipeline, you just need to call a single configuration method when setting up your application services:

```c#
var builder = WebApplication.CreateBuilder(args);

builder.Services.AddControllers()
    .AddJsonSchemaValidation(); // add this
```

The `.AddJsonSchemaValidation()` call extends the `IMvcBuilder` returned by `.AddControllers()` and `.AddControllersWithViews()`. This will add a custom model binder and filter to the pipeline as well as the `GenerativeValidatingJsonConverter` to the default JSON serializer options.

From here, you just need to start decorating your top-level controller parameters with a `[JsonSchema()]` attribute or a `[GenerateJsonSchema]` attribute, and everything else will just work.

## Output

The extension method will add a model binder to check for a parameter that's expected to be in the body.  If found, it will run the serialization as normal, but it will catch any `JsonException`s and check for validation failures.  If there are any, it will add them to the model state.  Then it marks the binding as failed.

The filter then picks up on any binding errors and checks for ones produced by JSON Schema validation.  If there are any, it will format a Problem Details payload to include the errors.

The errors can be found in an `errors` property in the root.  This property's value is an object whose keys are JSON Pointers that indicate where in the request body the failure occurred, the corresponding values being arrays of errors (since multiple errors could have been produced for a single location).

## Configuration

The `AddJsonSchemaValidation()` method also takes an action parameter that allows you to configure the `GenerativeValidatingJsonConverter`.  With this you gain full access to the converter to update any of its configurations.

By default, the following is configured for camelCase property naming and `format` validation.

`format` generally isn't validated with JSON Schema, but it's my experience that most people seem to expect it to be enabled.

> The validation output format is always coerced to Hierarchical since that's required for the filter's extraction logic to work properly.  Otherwise, you won't get errors out of the API.
{: .prompt-info }

## Wrapping up

The way I see it, there's really no reason not to include JSON Schema validation in your ASP.Net pipeline.  It has made my code so much cleaner.  Now can do this same for yours!

_If you aren't generating revenue, you like the work I put out, and you would still like to support the project, please consider [becoming a sponsor](https://github.com/sponsors/gregsdennis)!_