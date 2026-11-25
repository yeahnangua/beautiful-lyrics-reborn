import Spring from "./Spring.ts"
/** Compatibility adapter preserving the legacy constructor order. */
export default class LegacySpring {
 private readonly Spring: Spring
 constructor(initial: number, dampingRatio: number, frequency: number) { this.Spring = new Spring(initial, frequency, dampingRatio) }
 get Position(): number { return this.Spring.GetPosition() }
 get Final(): number { return this.Spring.GetGoal() }
 set Final(value: number) { this.Spring.SetGoal(value) }
 Update(deltaTime: number): number { return this.Spring.Step(deltaTime) }
 Set(value: number): void { this.Spring.SetGoal(value, true) }
 SetFrequency(value: number): void { this.Spring.SetFrequency(value) }
 SetDampingRatio(value: number): void { this.Spring.SetDampingRatio(value) }
 IsSleeping(): boolean { return this.Spring.CanSleep() }
}
