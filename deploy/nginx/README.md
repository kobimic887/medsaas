# Long-running scientific requests

Include `scientific-timeouts.conf` inside the existing Pyxis HTTPS **server**
block so production and staging inherit it. The staging location template also
sets the same timeout explicitly. Preserve existing proxy destinations, path
rewriting, headers, certificates, and other sites.

nginx defaults to 60 seconds between upstream reads. Docking, DiffDock and
OpenFold3 allow 600 seconds for inference; Home waits 660 seconds. A 650-second
proxy read timeout lets the application return its own result or error first.
It does not fix a provider outage or extend application timeouts. Preparation
and transfer also consume time, so verify representative slow requests before
claiming end-to-end readiness.

Live edits require owner approval. Back up the measured site file and application
source first. Validate with `nginx -t`, reload only nginx, then verify health and
a real authenticated scientific request. For an application refund fix, deploy
only the reviewed source patch and restart only the approved app unit. Check
failed-job credit settlement as well as response status. Roll back the exact
saved site/source and validate/reload/restart the corresponding service if the
checks fail. Do not replace the live source with all of main as part of this fix.
