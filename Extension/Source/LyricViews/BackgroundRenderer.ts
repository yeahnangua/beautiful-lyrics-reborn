import { FragmentShader, VertexShader } from "./Shaders.ts"

/** The background is one textured full-screen quad; no scene graph is needed. */
export class BackgroundRenderer {
	readonly canvas = document.createElement("canvas")
	private readonly gl: WebGLRenderingContext
	private readonly program: WebGLProgram
	private readonly buffer: WebGLBuffer
	private readonly texture: WebGLTexture
	private readonly shaders: WebGLShader[] = []
	constructor() {
		const gl = this.canvas.getContext("webgl", { alpha: true, premultipliedAlpha: false })
		if (!gl) throw new Error("WebGL unavailable")
		this.gl = gl
		try {
		const compile = (type: number, source: string) => {
			const shader = gl.createShader(type)!
			this.shaders.push(shader)
			gl.shaderSource(shader, source); gl.compileShader(shader)
			if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error("Background shader failed")
			return shader
		}
		this.program = gl.createProgram()!
		gl.attachShader(this.program, compile(gl.VERTEX_SHADER, "attribute vec3 position;\n" + VertexShader))
		gl.attachShader(this.program, compile(gl.FRAGMENT_SHADER, "precision mediump float;\n" + FragmentShader))
		gl.linkProgram(this.program)
		if (!gl.getProgramParameter(this.program, gl.LINK_STATUS)) throw new Error("Background link failed")
		gl.useProgram(this.program)
		this.buffer = gl.createBuffer()!
		gl.bindBuffer(gl.ARRAY_BUFFER, this.buffer)
		gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1,0, 1,-1,0, -1,1,0, -1,1,0, 1,-1,0, 1,1,0]), gl.STATIC_DRAW)
		const position = gl.getAttribLocation(this.program, "position")
		gl.enableVertexAttribArray(position); gl.vertexAttribPointer(position, 3, gl.FLOAT, false, 0, 0)
		this.texture = gl.createTexture()!
		gl.bindTexture(gl.TEXTURE_2D, this.texture)
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST)
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST)
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
		gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, 1)
		gl.uniform1i(gl.getUniformLocation(this.program, "BlurredCoverArt"), 0)
		} catch (error) {
			this.shaders.forEach(shader => gl.deleteShader(shader))
			gl.getExtension("WEBGL_lose_context")?.loseContext()
			throw error
		}
	}
	setImage(image: OffscreenCanvas): void {
		this.gl.bindTexture(this.gl.TEXTURE_2D, this.texture)
		this.gl.texImage2D(this.gl.TEXTURE_2D, 0, this.gl.RGBA, this.gl.RGBA, this.gl.UNSIGNED_BYTE, image)
	}
	resize(width: number, height: number): void {
		const gl = this.gl, dpr = globalThis.devicePixelRatio || 1
		const w = Math.max(1, Math.round(width * dpr)), h = Math.max(1, Math.round(height * dpr))
		if (this.canvas.width === w && this.canvas.height === h) return
		this.canvas.width = w; this.canvas.height = h
		this.canvas.style.width = `${width}px`; this.canvas.style.height = `${height}px`
		gl.viewport(0, 0, w, h)
		const size = Math.max(w, h), wide = w > h
		const circle = (name: string, x: number, y: number, radius: number) => {
			gl.uniform2f(gl.getUniformLocation(this.program, name + "Origin"), x, y)
			gl.uniform1f(gl.getUniformLocation(this.program, name + "Radius"), radius)
		}
		circle("BackgroundCircle", w / 2, h / 2, size * 1.5)
		circle("CenterCircle", w / 2, h / 2, size * (wide ? 1 : 0.75))
		circle("LeftCircle", 0, h, size * 0.75)
		circle("RightCircle", w, 0, size * (wide ? 0.65 : 0.5))
	}
	render(): void {
		this.gl.uniform1f(this.gl.getUniformLocation(this.program, "Time"), performance.now() / 3500)
		this.gl.drawArrays(this.gl.TRIANGLES, 0, 6)
	}
	destroy(): void {
		this.gl.deleteTexture(this.texture); this.gl.deleteBuffer(this.buffer)
		this.shaders.forEach(shader => this.gl.deleteShader(shader)); this.gl.deleteProgram(this.program)
		this.gl.getExtension("WEBGL_lose_context")?.loseContext()
	}
}
