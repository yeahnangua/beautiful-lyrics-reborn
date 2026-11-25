// Spicetify Services
import { IsDevelopment } from "./Session.ts"

// Configuration Types
export type ExpirationSettings = {
	Duration: number;
	Unit: ("Minutes" | "Days" | "Weeks" | "Months");
}

// Instant Store Types
type InstantStoreItems = Record<string, unknown>
type InstantStore = {
	Version: number;
	Items: InstantStoreItems;
}

// Expire Store Types
type ExpireItem<C> = {
	ExpiresAt: number;
	CacheVersion: number;

	Content: C;
}

// Instant Store
type InstantStoreInterface<Items> = {
	Items: Items;
	SaveChanges: () => void;
}

const RetrievedInstantStores: Set<string> = new Set()
export const GetInstantStore = <InstantStoreTemplate extends InstantStoreItems>(
	storeName: string, version: number,
	template: InstantStoreTemplate,
	forceNewData?: true
): Readonly<InstantStoreInterface<InstantStoreTemplate>> => {
	// Make sure we can't get the same store twice
	if (RetrievedInstantStores.has(storeName)) {
		throw new Error(`Can't retrieve InstantStore (${storeName}) twice.`)
	}
	RetrievedInstantStores.add(storeName)

	// Defaults also provide an in-memory store when persistence is unavailable.
	const isRecord = (value: unknown): value is InstantStoreItems => (
		typeof value === "object" && value !== null && !Array.isArray(value)
	)
	let store: InstantStore = { Version: version, Items: structuredClone(template) }
	if ((IsDevelopment === false) || (forceNewData === undefined)) {
		try {
			const serialized = localStorage.getItem(storeName)
			const parsed: unknown = serialized === null ? undefined : JSON.parse(serialized)
			if (isRecord(parsed) && parsed.Version === version && isRecord(parsed.Items)) {
				store = { Version: version, Items: parsed.Items }
			}
		} catch { /* Corrupt JSON or blocked storage must not prevent startup. */ }
	}
	// Repair only invalid template fields, retaining valid preferences and per-song maps.
	const checks: [InstantStoreItems, InstantStoreItems][] = [[store.Items, template]]
	while (checks.length > 0) {
		const [saved, defaults] = checks.pop()!
		for (const [key, fallback] of Object.entries(defaults)) {
			const value = Object.hasOwn(saved, key) ? saved[key] : undefined
			const valid = fallback === null ? value === null
				: Array.isArray(fallback) ? Array.isArray(value)
				: isRecord(fallback) ? isRecord(value)
				: typeof value === typeof fallback && (typeof value !== "number" || Number.isFinite(value))
			if (!valid) saved[key] = structuredClone(fallback)
			else if (isRecord(fallback) && isRecord(value)) checks.push([value, fallback])
		}
	}

	// Finally, return our public interface
	return Object.freeze(
		{
			Items: store.Items as InstantStoreTemplate,
			SaveChanges: () => {
				try { localStorage.setItem(storeName, JSON.stringify(store)) }
				catch { /* Keep edits usable in memory when storage is blocked or full. */ }
			}
		}
	)
}

// Dynamic Store
export const GetDynamicStoreItem = <I>(storeName: string, itemName: string): (I | undefined) => (
	(localStorage.getItem(`${storeName}:${itemName}`) as unknown as I)
	?? undefined
)
export const SetDynamicStoreItem = (storeName: string, itemName: string, content: string): void => (
	localStorage.setItem(`${storeName}:${itemName}`, content)
)

// Expire Store
const GetFromCacheAPI = <C>(storeName: string, itemName: string): Promise<C | undefined> => (
	caches.open(storeName)
	.then(cache => cache.match(`/${itemName}`))
	.then(response => response?.json())
)
const UpdateCacheAPI = (storeName: string, itemName: string, content: unknown): Promise<void> => (
	caches.open(storeName)
	.then(
		cache => cache.put(
			`/${itemName}`,
			new Response(
				JSON.stringify(content),
				{
					headers: {
						'Content-Type': 'application/json'
					}
				}
			)
		)
	)
	.catch(
		error => {
			console.warn(`Failed to Update Cache API (${storeName}/${itemName})`)
			console.error(error)
		}
	)
)

type ExpireStoreInterface<ItemType> = {
	GetItem: (itemName: string) => Promise<ItemType | undefined>;
	SetItem: (itemName: string, content: ItemType, expirationOverride?: ExpirationSettings) => Promise<ItemType>;
	Clear: () => Promise<boolean>;
	DeleteItem: (itemName: string) => Promise<boolean>;
}

const RetrievedExpireStores: Set<string> = new Set()
export const GetExpireStore = <ItemType>(
	storeName: string, version: number,
	itemExpirationSettings: ExpirationSettings,
	forceNewData?: true
): Readonly<ExpireStoreInterface<ItemType>> => {
	// Make sure we can't get the same store twice
	if (RetrievedExpireStores.has(storeName)) {
		throw new Error(`Can't retrieve ExpireStore (${storeName}) twice.`)
	}
	RetrievedExpireStores.add(storeName)
	// Sweep only this extension-owned store, yielding between small batches.
	void (async () => {
		const cache = await caches.open(storeName)
		const keys = await cache.keys()
		for (let i = 0; i < keys.length; i += 32) {
			await Promise.all(keys.slice(i, i + 32).map(async key => {
				const item = await cache.match(key).then(response => response?.json()).catch(() => undefined)
				if (!item || item.CacheVersion !== version || !Number.isFinite(item.ExpiresAt) || item.ExpiresAt <= Date.now()) await cache.delete(key)
			}))
			if (i + 32 < keys.length) await new Promise(resolve => setTimeout(resolve, 0))
		}
	})().catch(() => {})

	// Return our public interface
	return Object.freeze(
		{
			Clear: () => caches.delete(storeName),
			DeleteItem: (itemName: string) => caches.open(storeName).then(cache => cache.delete(`/${itemName}`)),
			GetItem: (itemName: string) => (
				(IsDevelopment && forceNewData) ? Promise.resolve(undefined)
				: (
					GetFromCacheAPI<ExpireItem<ItemType>>(storeName, itemName)
						.catch(async () => { await caches.open(storeName).then(cache => cache.delete(`/${itemName}`)).catch(() => {}); return undefined })
					.then(
						expireItem => {
							// If we don't have an item then just force-return
							if (expireItem === undefined || expireItem === null || typeof expireItem !== "object") {
								return undefined
							}
			
							// Check if we're on the same version
							if (expireItem.CacheVersion !== version) {
								void caches.open(storeName).then(cache => cache.delete(`/${itemName}`)).catch(() => {})
								return undefined
							}
			
							// Check if we're expired
							if (!Number.isFinite(expireItem.ExpiresAt) || expireItem.ExpiresAt <= Date.now()) {
								void caches.open(storeName).then(cache => cache.delete(`/${itemName}`)).catch(() => {})
								return undefined
							}
			
							// Otherwise, return our content
							return expireItem.Content
						}
					)
				)
			),
			SetItem: (itemName: string, content: ItemType, expirationOverride?: ExpirationSettings) => {
				// Determine when we expire
				const expirationSettings = (expirationOverride ?? itemExpirationSettings)
				const expireAtDate = new Date()
				if (expirationSettings.Unit == "Minutes") {
					expireAtDate.setTime(expireAtDate.getTime() + (expirationSettings.Duration * 60_000))
				} else {
					expireAtDate.setHours(0, 0, 0, 0)
					if (expirationSettings.Unit == "Days") {
						expireAtDate.setDate(expireAtDate.getDate() + expirationSettings.Duration)
					} else if (expirationSettings.Unit == "Weeks") {
						expireAtDate.setDate(expireAtDate.getDate() + (expirationSettings.Duration * 7))
					} else {
						const day = expireAtDate.getDate()
						expireAtDate.setDate(1)
						expireAtDate.setMonth(expireAtDate.getMonth() + expirationSettings.Duration)
						expireAtDate.setDate(Math.min(day, new Date(expireAtDate.getFullYear(), expireAtDate.getMonth() + 1, 0).getDate()))
					}
				}
				const expireAt = expireAtDate.getTime()
	
				// Create our expire-item
				const expireItem: ExpireItem<ItemType> = {
					ExpiresAt: expireAt,
					CacheVersion: version,
	
					Content: content
				}
	
				// Store ourselves
				return UpdateCacheAPI(
					storeName,
					itemName, expireItem
				).then(() => content)
			}
		}
	)
}
