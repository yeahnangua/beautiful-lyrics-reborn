type ExternalID = {
	type: string;
	id: string;
};

type ArtistDetails = {
	gid: string;
	name: string;
};

type Image = {
	file_id: string;
	size: string;
	width: number;
	height: number;
};

type Licensor = {
	uuid: string;
};

export type TrackReleaseDate = {
	year: number;
	month?: number;
	day?: number;
};

type CoverGroup = {
	image: Image[];
};

type File = {
	file_id: string;
	format: string;
};

type Album = {
	gid: string;
	name: string;
	artist: ArtistDetails[];
	label: string;
	date: TrackReleaseDate;
	cover_group: CoverGroup;
	licensor: Licensor;
};

export type TrackInformation = {
	gid: string;
	name: string;
	album: Album;
	artist: ArtistDetails[];
	number: number;
	disc_number: number;
	duration: number;
	popularity: number;
	external_id: ExternalID[];
	file: File[];
	preview: File[];
	earliest_live_timestamp: number;
	licensor: Licensor;
	language_of_performance: string[];
	original_audio: Licensor;
	original_title: string;
	artist_with_role: {
		artist_gid: string;
		artist_name: string;
		role: string;
	}[];
	canonical_uri: string;
};

export type TrackInformationResponse = {
	url: string;
	status: number;
	headers: null;
	body: TrackInformation;
	offline: boolean;
	timing: null;
	metadata: null;
	retries: {
		count: number;
	};
	ok: boolean;
};