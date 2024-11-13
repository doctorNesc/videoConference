import { Routes } from '@angular/router';
import { VideoRoomComponent } from './components/video-room/video-room.component';
import { HomeComponent } from './components/home/home.component';
import { AppComponent } from './app.component';

export const routes: Routes = [
    { path: 'hello', component: HomeComponent },
    { path: 'sfu/:roomName', component: VideoRoomComponent },
    { path: '**', redirectTo: '/hello', pathMatch: 'full' },
];
