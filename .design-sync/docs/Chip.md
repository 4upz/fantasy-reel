---
category: Foundation
---

# Chip

A compact selectable button shared by the offer-expiry picker and the trade
extension dialog. `selected` drives both the gold outline and `aria-pressed`;
the parent owns selection through `onClick`.

Use `disabled` for unavailable choices and `title` for a brief explanation.
The preview shows an interactive duration group and an unavailable release
choice. This is a button, so use concise action or option text as its children.
