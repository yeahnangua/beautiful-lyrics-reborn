// Spicetify Services
import { IsDevelopment } from "./Session.ts"

// Configuration Types
export type ExpirationSettings = {
	Duration: number;
	Unit: ("Weeks" | "Months");
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

	// Retrieve our store
	let store: InstantStore = (undefined as unknown as InstantStore)
	{
		if ((IsDevelopment === false) || (forceNewData === undefined)) {
			const serializedStore = localStorage.getItem(storeName)
			if (serializedStore !== null) {
				const parsedStore = JSON.parse(serializedStore) as InstantStore
				if (parsedStore.Version === version) {
					store = parsedStore
				}
			}
		}

		if (store === undefined) {
			store = {
				Version: version,
				Items: JSON.parse(JSON.stringify(template))
			}
		} else {
			const templateChecks: [Record<string, unknown>, Record<string, unknown>, string][] = [[store, template, storeName]]
			while (templateChecks.length > 0) {
				const [check, against, path] = templateChecks.pop()!
				for (const key in against) {
					const checkValue = check[key]
					const againstValue = against[key]
					if (checkValue === undefined) {
						check[key] = JSON.parse(JSON.stringify(againstValue))
					} else {
						const checkValueType = typeof checkValue
						if (checkValueType !== (typeof againstValue)) {
							throw new Error(`Template Type mismatch for "${`${path}.${key}`}"`)
						} else if (checkValueType === "object") {
							templateChecks.push(
								[
									checkValue as Record<string, unknown>,
									againstValue as Record<string, unknown>,
									`${path}.${key}`
								]
							)
						}
					}
				}
			}
		}
	}

	// Finally, return our public interface
	return Object.freeze(
		{
			Items: store.Items as InstantStoreTemplate,
			SaveChanges: () => localStorage.setItem(storeName, JSON.stringify(store))
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
	SetItem: (itemName: string, content: ItemType) => Promise<ItemType>;
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

	// Return our public interface
	return Object.freeze(
		{
			GetItem: (itemName: string) => (
				(IsDevelopment && forceNewData) ? Promise.resolve(undefined)
				: (
					GetFromCacheAPI<ExpireItem<ItemType>>(storeName, itemName)
					.then(
						expireItem => {
							// If we don't have an item then just force-return
							if (expireItem === undefined) {
								return undefined
							}
			
							// Check if we're on the same version
							if (expireItem.CacheVersion !== version) {
								return undefined
							}
			
							// Check if we're expired
							if (expireItem.ExpiresAt < Date.now()) {
								return undefined
							}
			
							// Otherwise, return our content
							return expireItem.Content
						}
					)
				)
			),
			SetItem: (itemName: string, content: ItemType) => {
				// Determine when we expire
				const expireAtDate = new Date()
				expireAtDate.setHours(0, 0, 0, 0)
				if (itemExpirationSettings.Unit == "Weeks") {
					expireAtDate.setDate(expireAtDate.getDate() + (itemExpirationSettings.Duration * 7))
				} else {
					expireAtDate.setMonth(expireAtDate.getMonth() + itemExpirationSettings.Duration)
					expireAtDate.setDate(0)
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