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

type Collaborator = {
	isOwner: boolean;
	tracksAdded: number;
	user: User;
}

type Duration = {
	milliseconds: number;
	isEstimate: boolean;
}

type Permissions = {
	canView: boolean;
	canAdministratePermissions: boolean;
	canCancelMembership: boolean;
	isPrivate: boolean;
}

type PlaylistMetadata = {
	type: "playlist";
	uri: string;
	name: string;
	description: string;
	images: Image[];
	madeFor: null; // Replace with appropriate type if other values are possible
	owner: User;
	totalLength: number;
	unfilteredTotalLength: number;
	totalLikes: number;
	duration: Duration;
	isLoaded: boolean;
	isOwnedBySelf: boolean;
	isPublished: boolean;
	hasEpisodes: boolean;
	hasSpotifyTracks: boolean;
	hasSpotifyAudiobooks: boolean;
	canAdd: boolean;
	canRemove: boolean;
	canPlay: boolean;
	formatListData: null; // Replace with appropriate type if other values are possible
	canReportAnnotationAbuse: boolean;
	hasDateAdded: boolean;
	permissions: Permissions;
	collaborators: {
		count: number;
		items: Collaborator[];
	};
}
export default PlaylistMetadata