<!-- railing:start -->
## Rules that are checked, not remembered (railing)

Every rule here is enforced by `railing gate`, which CI, the git hooks and you all run. Do not ask to loosen a rule: change the code. A rule's number can only get stricter.

- Run `npx railing gate` before you say a task is done. If it fails, fix the cause; never switch a rule off to pass.
- `railing.config.json` lists the rules, the folders they cover and the steps (lint, types, tests) the gate runs.
- An exemption is `railing-ok: <reason>` on or above the line, with a real reason. No reason, no exemption.
- A bug fix ships with a test that fails without the fix. Put the bug back, watch the test fail, remove it.
- Keep files under the line limit in the config. Split a file before it grows past it.
- `.railing/floors.json` holds numbers that may only improve (for example a coverage floor). Raise them when you can; never lower them.
<!-- railing:end -->
