// The following image is a visual representation of the stages in a single frame
// https://miro.medium.com/v2/resize:fit:1400/format:webp/1*ad-k5hYKQnRQJF8tv8BIqg.png

// Define a simple and easy data format for keeping track of scheduled tasks
type Scheduled = [(0 | 1 | 2), number, true?] // First defines which type of task was scheduled, second is its id
export const Cancel = (scheduled: Scheduled) => {
	if (scheduled[2]) {
		return // Prevents any logic processing on a cancelled task
	}

	scheduled[2] = true

	switch (scheduled[0]) {
		case 0: globalThis.clearTimeout(scheduled[1]); break;
		case 1: globalThis.clearInterval(scheduled[1]); break;
		case 2: globalThis.cancelAnimationFrame(scheduled[1]); break;
	}
}

// QOL Type
// deno-lint-ignore no-explicit-any
type ScheduledCallback = (...args: any[]) => void

// Handle Javascript Timer Scheduling
export const Timeout = (seconds: number, callback: ScheduledCallback): Scheduled => {
	return [0, setTimeout(callback, (seconds * 1000))]
}
export const Interval = (everySeconds: number, callback: ScheduledCallback): Scheduled => {
	return [1, setInterval(callback, (everySeconds * 1000))]
}

// Now handle Browser Event Scheduling
export const OnPreRender = (callback: ScheduledCallback): Scheduled => {
	return [2, requestAnimationFrame(callback)]
}
export const Defer = (callback: ScheduledCallback): Scheduled => {
	const scheduled: Scheduled = [2, 0]

	scheduled[1] = requestAnimationFrame(
		() => {
			scheduled[0] = 0
			scheduled[1] = setTimeout(callback, 0)
		}
	)

	return scheduled
}

export type { Scheduled }
export const IsScheduled = (value: unknown): value is Scheduled => {
	return (
		Array.isArray(value)
		&& ((value.length === 2) || (value.length === 3))
		&& (typeof value[0] === 'number')
		&& (typeof value[1] === 'number')
		&& ((value[2] === undefined) || (value[2] === true))
	)
}