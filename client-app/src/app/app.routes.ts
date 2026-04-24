import { Routes } from '@angular/router';
import { VideoRoomComponent } from './components/video-room/video-room.component';
import { HomeComponent } from './components/home/home.component';
import { AppComponent } from './app.component';
import { AdminComponent } from './components/admin/admin.component';
import { ClassroomComponent } from './components/classroom/classroom.component';
import { RealSpaceComponent } from './components/real-space/real-space.component';
import { DisplayPickerComponent } from './components/display-picker/display-picker.component';
import { AdminRoomsComponent } from './components/admin/admin-rooms/admin-rooms.component';
import { RoomEditorComponent } from './components/admin/room-editor/room-editor.component';

export const routes: Routes = [
  // Admin routes
  { path: 'admin', component: AdminRoomsComponent },
  { path: 'admin/room/:name', component: RoomEditorComponent },

  // Video conference routes
  { path: 'hello', component: HomeComponent },
  { path: 'classRoom', component: ClassroomComponent },
  { path: 'sfu/:roomName', component: VideoRoomComponent },
  { path: 'display-picker/:roomName', component: DisplayPickerComponent },

  // Legacy/special routes
  { path: 'B405', component: RealSpaceComponent },

  // Default redirect
  { path: '**', redirectTo: '/hello', pathMatch: 'full' },
];
