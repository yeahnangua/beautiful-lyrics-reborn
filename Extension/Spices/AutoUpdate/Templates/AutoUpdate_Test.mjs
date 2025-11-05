// Define our port
const Port = -1 // This is replaced by the build-script

// Wait for Spicetify/Snackbar to load
await new Promise(
	resolve => {
		const interval = setInterval(
			() => {
				if ((Spicetify !== undefined) && (Spicetify.Snackbar !== undefined)) {
					clearInterval(interval)
					resolve()
				}
			},
			10
		)
	}
)

// Handle version updating
const QueuedVersionImports = []
let currentVersion, importing = false
let activeMaid, activeStyling
const UpdateVersion = (toVersion) => {
	// First, make sure that we aren't updating to the current version
	if ((toVersion === currentVersion) || QueuedVersionImports.includes(toVersion)) {
		return
	} else if (importing) {
		QueuedVersionImports.push(toVersion)
		return
	}

	// Update our state
	importing = true
	const fromVersion = currentVersion
	currentVersion = toVersion

	// Clean-up our previous imports
	{
		if (activeMaid !== undefined) {
			activeMaid.Destroy()
			activeMaid = undefined
		}

		if (activeStyling !== undefined) {
			activeStyling.remove()
			activeStyling = undefined
		}
	}

	// Create our style immediately
	{
		activeStyling = document.createElement("link")
		activeStyling.rel = "stylesheet"
		activeStyling.href = `http://localhost:${Port}/bundle@${toVersion}.css`
		document.body.appendChild(activeStyling)
	}

	// Handle importing process
	{
		import(`http://localhost:${Port}/bundle@${toVersion}.mjs`)
		.then(
			module => {
				// Handle our module
				activeMaid = module.default

				// Handle notifiying that we updated
				if (fromVersion !== undefined) {
					if (module.UpdateNotice.Type === "Notification") {
						Spicetify.Snackbar.enqueueSnackbar(
							Spicetify.React.createElement(
								"div",
								{
									dangerouslySetInnerHTML: {
										__html: `<h3>${module.UpdateNotice.Name} Updated!</h3>
										<span style = 'opacity: 0.75;'>Version ${fromVersion} -> ${toVersion}</span>`.trim()
									}
								}
							), {
								variant: "success",
								autoHideDuration: 5000
							}
						)
					}
				}

				// Update our state
				importing = false

				// Check if we have any queued imports
				if (QueuedVersionImports.length > 0) {
					UpdateVersion(QueuedVersionImports.shift())
				}
			}
		)
	}
}

// Now handle receiving our version updates
{
	const webSocket = new WebSocket(`ws://localhost:${Port}/ws`)
	webSocket.onmessage = event => UpdateVersion(parseInt(event.data))
	webSocket.onclose = () => console.log("STOPPED AUTO-UPDATING!")
	webSocket.onopen = () => webSocket.send("")
}