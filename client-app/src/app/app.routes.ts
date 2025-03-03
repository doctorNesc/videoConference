import { Routes } from '@angular/router';
import { VideoRoomComponent } from './components/video-room/video-room.component';
import { HomeComponent } from './components/home/home.component';
import { AppComponent } from './app.component';
import { AdminComponent } from './components/admin/admin.component';
import { ClassroomComponent } from './components/classroom/classroom.component';

export const routes: Routes = [
  { path: 'admin', component: AdminComponent },
  { path: 'hello', component: HomeComponent },
  { path: 'classRoom', component: ClassroomComponent },
  { path: 'sfu/:roomName', component: VideoRoomComponent },
  { path: '**', redirectTo: '/hello', pathMatch: 'full' },
];
