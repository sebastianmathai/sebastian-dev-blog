---
layout: ../../layouts/Article.astro
title: A notebook for understanding C++
description: Practical questions, small examples, and mental models that make the language easier to reason about.
date: "22 September 2026"
category: From the editor
readingTime: 2 min read
---

Welcome to Sebastian Dev Blog: a notebook about C++, embedded software, and the reasoning behind good design.

Learning a language means more than recognizing its syntax. It means being able to explain what an object owns, how long it lives, which operations are valid, and what assumptions a design depends on.

This blog will explore those questions through focused explanations and small code examples.

## Start with a question

Why does declaring a constructor change which constructors the compiler generates? What does `const` promise, and what does it leave unchanged? When does a responsibility deserve its own class?

These are the kinds of questions this notebook is for. Each technical article will aim to connect a concrete problem to the rule behind it, then explain where that rule matters in practice.

## What to expect

- **C++ mental models:** ownership, lifetime, constness, and language behavior.
- **Embedded software:** working with devices, binary data, and data pipelines.
- **Software design:** class boundaries, invariants, and explicit trade-offs.

The goal is to use examples that are small enough to examine and complete enough to run. Technical posts should identify the C++ standard they use, distinguish language guarantees from implementation details, and link to supporting references.

## Understanding is a work in progress

A useful explanation should make it easier to ask the next question. Corrections and thoughtful questions are welcome through the [blog repository](https://github.com/sebastianmathai/sebastian-dev-blog).

This is the starting point. The technical notebook grows from here.
