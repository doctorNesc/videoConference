import { Routes } from '@angular/router';
import { VideoRoomComponent } from './components/video-room/video-room.component';

export const routes: Routes = [
    { path: 'sfu/::roomName', component: VideoRoomComponent },
];
