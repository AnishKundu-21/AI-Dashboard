# ADR 0001: Keep analytics attribution opt-in and local-only

## Status

Accepted

## Decision

Future repository, branch, and device filters will only use opt-in, locally
stored metadata. The permitted values are a repository basename, a branch name,
and a user-editable device label.

The application will not persist full filesystem paths, remote URLs, usernames,
prompt or response content, or source files. Existing historical records are
not retroactively enriched because those values were intentionally not retained.

## Consequences

The filters are privacy-safe and explainable, but their coverage begins when a
user enables attribution. The UI must disclose that partial coverage rather than
silently treating unlabelled history as a separate repository or device.
