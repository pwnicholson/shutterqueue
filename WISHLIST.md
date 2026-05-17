# ShutterQueue Wishlist / Roadmap

## Soon

* \[ ] Ability to set batches of various sizes to upload together ("Manual batch"?)

## Nice-to-have

* \[ ] **Reduce aggressive polling in main process** — audit all `setInterval` calls in `electron/main.cjs` (scheduler, Lemmy retry, transient retry timers) and replace with event-driven triggers where possible. Currently polls every 1–60 seconds for things that could be push-notified internally.
* \[ ] Implement support for Tumblr Communities
* \[ ] Implement support for Substack
* \[ ] Implement support for Pixfed.com
* \[ ] Implement support for YouPic
* \[ ] Implement support for Glass
* \[ ] Implement support for Foto
* \[ ] Implement support for tokenized back ends which would open up possibilities for...
- * \[ ] Implement support for Instagram
- * \[ ] Implement support for Threads
- * \[ ] Implement support for Reddit Photo groups? (not likely)
