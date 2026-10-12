# Security

If you find a security problem (for example a way to make the server fetch an arbitrary address, expose a secret, or serve harmful content), please report it **privately** using GitHub's "Report a vulnerability" button on the repository's Security tab, instead of opening a public issue. You'll get a reply as soon as the maintainer can.

What is in scope: this repository's code and the live site. What is not: the cameras themselves (report a camera problem as a normal issue) and the third-party services we link to.

This project has no accounts, no cookies and no stored personal data. Secrets (the API keys) live only in the host's environment variables or secret store and in a local, untracked `.env` file.
