type ExternalUrls = {
	spotify: string;
}

type ExternalIds = {
	isrc: string;
}

type Image = {
	height: number;
	url: string;
	width: number;
}

export type ArtistDetails = {
	external_urls: ExternalUrls;
	href: string;
	id: string;
	name: string;
	type: string;
	uri: string;
}

export type AlbumType = ("album" | "single" | "compilation")
type Album = {
	album_type: AlbumType;
	artists: ArtistDetails[];
	available_markets: string[];
	external_urls: ExternalUrls;
	href: string;
	id: string;
	images: Image[];
	name: string;
	release_date: string;
	release_date_precision: string;
	total_tracks: number;
	type: string;
	uri: string;
}

export type TrackInformation = {
	album: Album;
	artists: ArtistDetails[];
	available_markets: string[];
	disc_number: number;
	duration_ms: number;
	explicit: boolean;
	external_ids: ExternalIds;
	external_urls: ExternalUrls;
	href: string;
	id: string;
	is_local: boolean;
	name: string;
	popularity: number;
	preview_url: string;
	track_number: number;
	type: string;
	uri: string;
}