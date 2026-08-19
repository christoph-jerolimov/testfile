---
title: Playwright + web app
order: 2
stack: JavaScript
description: >-
  Build the app, start API and frontend as services, run the browser tests
  against them — traces and screenshots are kept with the run.
---

# Playwright + web app

Build the app, start API and frontend as services, run the browser tests
against them — traces and screenshots are kept with the run.

This guide shows:

- Two process services with HTTP readiness checks
- Random ports flow into the app config and into `BASE_URL`
- Reports, screenshots and traces collected as `artifacts`
- `retry` for the notoriously flaky browser layer
