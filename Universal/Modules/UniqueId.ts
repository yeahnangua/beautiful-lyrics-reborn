/** UUIDs need no process-lifetime registry. */
export const GetUniqueId = (): string => crypto.randomUUID()
