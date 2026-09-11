---
category: Settings
---

# DateTimeField

Controlled native date-and-time input with an associated label. Pass `value`,
`min` and `max` as local wall-clock strings in `YYYY-MM-DDTHH:mm` format;
an empty `value` clears the input. `onChange` returns that string without
converting it to a UTC timestamp. The caller owns timezone conversion and
validation; native limits alone do not enforce application rules.

Set `error` to show an announced message and connect it to the invalid field.
`className` styles the outer wrapper. Picker appearance varies by browser
and device. The preview stories keep local state so editing and clearing
work, and the bounded example clears its error when the value becomes valid.
