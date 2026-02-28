# ShutterQueue — A paced uploader for Flickr (v0.7.8b)

Releases can be downloaded on our Release page
https://github.com/pwnicholson/shutterqueue/releases

Note that this is purely vibe-coded using a combination of different AI tools. I am very open to suggestions, feedback, and help optimizing the tool or adding features.


## Setup Process



First, install the app!



1. ✅ Go to Flickr's Developer Page (usually https://www.flickr.com/services/ ) and click "Get an API key"

   * Choose "Non-commercial" for your key type
   * Name the app whatever you like (I suggest something like "ShutterQueue - \[your user name]"
   * Read and acknowledge the Flickr terms (and seriously, don't use this tool to abuse the API!)

2. ✅ Copy the API Key into the ShutterQueue setup tab
3. ✅ Copy the Secret Key into the ShutterQueue 'setup' tab
4. ✅ Click "Save", then click "Start Authorization."
5. ✅ **This will open a browser window to Flickr's OAuth page**

   * If you aren't already logged into Flickr, you'll need to log in to your account. This will NOT give ShutterQueue your account information.

6. ✅ Click the "Ok I'll Authorize It" button

   * This should return you to the ShutterQueue app and you should now be logged in!

## Security

As of v0.7.8b, ShutterQueue stores your sensitive credentials (API Secret, OAuth tokens) in an encrypted format using Electron's **`safeStorage` API**. This API leverages your operating system's native credential storage:

- **Windows**: Credentials are encrypted using the Windows Data Protection API (DPAPI)  
- **macOS**: Credentials are stored in the system Keychain
- **Linux**: Credentials are encrypted and stored in the user's credential store

This means your credentials are protected at the OS level and cannot be easily extracted from ShutterQueue's configuration files. Your API Key is stored in plain text (since it's public), but your API Secret and OAuth tokens are always encrypted at rest.

Note: If someone gains access to your computer's user account, they can still decrypt these credentials. This is a fundamental limitation of any local application.

## Licenses

The app includes a **View Third-Party Licenses** button in the Setup tab.

