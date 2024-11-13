export type Participant = {
    videoTrack?: MediaStreamTrack | undefined;
    audioTrack?: MediaStreamTrack | undefined;
    videoReady: boolean;
    audioReady: boolean;
    userName: string;
    local: boolean;
    id: string;
};

type Participants = {
    [key: string]: Participant;
};

export class CallComponent {
    participants: Participants = {};
}