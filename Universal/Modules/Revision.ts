/** A view owns one generation; late results cannot update a replacement or closed view. */
export class Revision {
	private Version = 0
	private Destroyed = false
	public Begin(): () => boolean {
		const version = ++this.Version
		return () => !this.Destroyed && this.Version === version
	}
	public Invalidate() { this.Version++ }
	public Destroy() { this.Destroyed = true; this.Invalidate() }
}
