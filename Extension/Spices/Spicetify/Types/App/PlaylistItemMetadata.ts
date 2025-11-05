type Image = {
	url: string;
	label: string;
}

type User = {
	type: string;
	uri: string;
	username: string;
	displayName: string;
	images: Image[];
}

type Duration = {
	milliseconds: number;
}

type ReleaseInfo = {
	date: string;
	precision: string;
}

type Show = {
	type: string;
	uri: string;
	name: string;
	publisher: string;
	images: Image[];
	mediaType: number;
}

type Artist = {
	type: string;
	uri: string;
	name: string;
}

type Album = {
	type: string;
	uri: string;
	name: string;
	artist: Artist;
	images: Image[];
}

type PodcastSubscription = {
	isPaywalled: boolean;
	isUserSubscribed: boolean;
}

type PlaylistItemMetadata = {
	uid: string;
	playIndex: number | null;
	addedAt: string;
	addedBy: User;
	formatListAttributes: object;
	type: string;
	uri: string;
	name: string;
	description: string;
	duration: Duration;
	timeLeft?: Duration;
	images: Image[];
	isExplicit: boolean;
	isPlayable: boolean;
	languages: string[];
	release?: ReleaseInfo;
	show?: Show;
	podcastSubscription?: PodcastSubscription;
	is19PlusOnly: boolean;
	album?: Album;
	artists?: Artist[];
	discNumber?: number;
	trackNumber?: number;
	isLocal?: boolean;
	hasAssociatedVideo?: boolean;
}
export default PlaylistItemMetadata