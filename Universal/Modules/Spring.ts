// Credits to https://github.com/Fraktality/spr/blob/master/spr.lua

// Localize our Math constants
const pi = Math.PI
const tau = (pi * 2)
const exp = Math.exp
const sin = Math.sin
const cos = Math.cos
const sqrt = Math.sqrt

// Behavior Constants
const SLEEP_OFFSET_SQ_LIMIT = ((1 / 3840) ** 2) // Square of the offset sleep limit
const SLEEP_VELOCITY_SQ_LIMIT = (1e-2 ** 2) // Square of the velocity sleep limit
const EPS = 1e-5 // Epsilon for stability checks around pathological frequency/damping values

// Class
export default class Spring {
	// Public Properties
	private DampingRatio: number;
	private Frequency: number;
	private Goal: number;
	private Position: number;
	private Velocity: number;

	// Constructor
	constructor(startPosition: number, frequency: number, dampingRatio: number, goal: number = startPosition) {
		// Validate that we can converge
		if ((frequency * dampingRatio) < 0) {
			throw new Error("Spring will not converge")
		}

		// Store our initial values
		this.DampingRatio = dampingRatio
		this.Frequency = frequency
		this.Goal = goal
		this.Position = startPosition
		this.Velocity = 0
	}

	// Public Methods
	public Step(deltaTime: number): number {
		/*
			Advance the spring simulation by dt seconds.
			Take the damped harmonic oscillator ODE:
			   f^2*(X[t] - g) + 2*d*f*X'[t] + X''[t] = 0
			Where X[t] is position at time t, g is target position,
			f is undamped angular frequency, and d is damping ratio.
			Apply constant initial conditions:
			   X[0] = p0
			   X'[0] = v0
			Solve the IVP to get analytic expressions for X[t] and X'[t].
			The solution takes one of three forms for 0<=d<1, d=1, and d>1
		*/

		const dampingRatio = this.DampingRatio
		const frequency = (this.Frequency * tau) // Hz -> Rad/s
		const goal = this.Goal
		const position = this.Position
		const velocity = this.Velocity

		if (dampingRatio === 1) { // Critically damped
			const q = exp(-frequency * deltaTime)
			const w = (deltaTime * q)

			const wScaledFrequency = (w * frequency)
			const c0 = (q + wScaledFrequency)
			const c2 = (q - wScaledFrequency)
			const c3 = (w * (frequency ** 2))

			const goalDistance = (position - goal)
			const newPosition = ((goalDistance * c0) + (velocity * w) + goal)
			const newVelocity = ((velocity * c2) - (goalDistance * c3))

			this.Position = newPosition, this.Velocity = newVelocity
			return newPosition
		} else if (dampingRatio < 1) { // Underdamped
			const frequencyStep = (frequency * deltaTime)

			const q = exp(-dampingRatio * frequencyStep)
			const c = sqrt(1 - (dampingRatio ** 2))

			const cFrequencyStep = (c * frequencyStep)
			const i = cos(cFrequencyStep)
			const j = sin(cFrequencyStep)

			/*
				Damping ratios approaching 1 can cause division by very small numbers.
				To mitigate that, group terms around z=j/c and find an approximation for z.
				Start with the definition of z:
				   z = sin(dt*f*c)/c
				Substitute a=dt*f:
				   z = sin(a*c)/c
				Take the Maclaurin expansion of z with respect to c:
				   z = a - (a^3*c^2)/6 + (a^5*c^4)/120 + O(c^6)
				   z ≈ a - (a^3*c^2)/6 + (a^5*c^4)/120
				Rewrite in Horner form:
				   z ≈ a + ((a*a)*(c*c)*(c*c)/20 - c*c)*(a*a*a)/6
			*/

			let z: number
			if (c > EPS) {
				z = (j / c)
			} else {
				const cSquared = (c ** 2)
				z = (
					frequencyStep
					+ (
						(((((frequencyStep ** 2) * cSquared * cSquared) / 20) - cSquared) * (frequencyStep ** 3))
						/ 6
					)
				)
			}

			/*
				Frequencies approaching 0 present a similar problem.
				We want an approximation for y as f approaches 0, where:
				   y = sin(dt*f*c)/(f*c)
				Substitute b=dt*c:
				   y = sin(b*c)/b
				Now reapply the process from z.
			*/

			let y: number
			const cFrequency = (frequency * c)
			if (cFrequency > EPS) {
				y = (j / cFrequency)
			} else {
				const cFrequencySquared = (cFrequency ** 2)
				y = (
					deltaTime
					+ (
						(((((deltaTime ** 2) * cFrequencySquared * cFrequencySquared) / 20) - cFrequencySquared) * (deltaTime ** 3))
						/ 6
					)
				)
			}

			const goalDistance = (position - goal)
			const newPosition = ((((goalDistance * (i + (z * dampingRatio))) + (velocity * y)) * q) + goal)
			const newVelocity = (((velocity * (i - (z * dampingRatio))) - (goalDistance * (z * frequency))) * q)

			this.Position = newPosition, this.Velocity = newVelocity
			return newPosition
		} else { // Overdamped
			const c = sqrt((dampingRatio ** 2) - 1)

			const r1 = (-frequency * (dampingRatio - c))
			const r2 = (-frequency * (dampingRatio + c))

			const ec1 = exp(r1 * deltaTime)
			const ec2 = exp(r2 * deltaTime)

			const goalDistance = (position - goal)
			const co2 = ((velocity - (goalDistance * r1))/(2 * frequency * c))
			const co1 = (ec1 * (goalDistance - co2))
			const coEc2 = (co2 * ec2)
			const newPosition = (co1 + coEc2 + goal)
			const newVelocity = (co1 * r1 + (coEc2 * r2))

			this.Position = newPosition, this.Velocity = newVelocity
			return newPosition
		}
	}

	public CanSleep(): boolean {
		return (
			(((this.Velocity ** 2) > SLEEP_VELOCITY_SQ_LIMIT) || (((this.Goal - this.Position) ** 2) > SLEEP_OFFSET_SQ_LIMIT))
			? false
			: true
		)
	}

	public GetGoal(): number {
		return this.Goal
	}

	public SetGoal(goal: number, replacePosition?: boolean) {
		this.Goal = goal

		if (replacePosition) {
			this.Position = goal
			this.Velocity = 0
		}
	}

	public SetDampingRatio(dampingRatio: number) {
		if ((this.Frequency * dampingRatio) < 0) {
			throw new Error("Spring will not converge")
		}

		this.DampingRatio = dampingRatio
	}

	public SetFrequency(frequency: number) {
		if ((frequency * this.DampingRatio) < 0) {
			throw new Error("Spring will not converge")
		}

		this.Frequency = frequency
	}
}