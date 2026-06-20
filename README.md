# eDock Apps

eDock-Apps is the central index and distribution repository for installable eDock applications. It provides metadata, versioning, and download sources for independently developed apps that integrate with the eDock runtime.

## Official App Index

The official eDock app index is:
```text
https://raw.githubusercontent.com/eManF/eDock-Apps/main/packages.json
```

For eDock Spotlight, this is used in:

```text
apps/user/data/emanf.spotlight/indexes.json
```

Example:

```text
{
  "app_indexes": [
    "https://raw.githubusercontent.com/eManF/eDock-Apps/main/packages.json"
  ]
}
```

## Pending App Index

There is also a pending app index:

```text
https://raw.githubusercontent.com/eManF/eDock-Apps/main/pending_packages.json
```

This index contains apps that passed basic validation but may not be fully reviewed yet.

Use it at your own risk.

Example:
```text
{
  "app_indexes": [
    "https://raw.githubusercontent.com/eManF/eDock-Apps/main/packages.json",
    "https://raw.githubusercontent.com/eManF/eDock-Apps/main/pending_packages.json"
  ]
}
```

## eDock App Submission

To submit your app:

1. Open `APP_SUBMISSION.md`
2. Copy the template
3. Create a new issue in this repository
4. Paste the template into the issue body
5. Replace `PASTE_MANIFEST_URL_HERE` with your app manifest URL
6. Add the `app-submission` label to the issue
7. Press `Create`
8. Wait a few seconds for the validation bot

If your app is valid, it will be marked for review.

Submission does not guarantee acceptance. Unsafe, broken, misleading, or duplicate apps may be rejected or removed.
