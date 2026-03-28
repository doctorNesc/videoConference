import { Routes } from '@angular/router';
import { VideoRoomComponent } from './components/video-room/video-room.component';
import { HomeComponent } from './components/home/home.component';
import { AppComponent } from './app.component';
import { AdminComponent } from './components/admin/admin.component';
import { ClassroomComponent } from './components/classroom/classroom.component';
import { RealSpaceComponent } from './components/real-space/real-space.component';
import { RoomDeviceViewComponent } from './components/room-device-view/room-device-view.component';
import { DisplayPickerComponent } from './components/display-picker/display-picker.component';
import { AdminRoomsComponent } from './components/admin/admin-rooms/admin-rooms.component';
import { RoomEditorComponent } from './components/admin/room-editor/room-editor.component';

export const routes: Routes = [
  { path: 'admin', component: AdminRoomsComponent },
  { path: 'admin/rooms/:name/setup', component: RoomEditorComponent },
  { path: 'hello', component: HomeComponent },
  { path: 'classRoom', component: ClassroomComponent },
  { path: 'sfu/:roomName', component: VideoRoomComponent },
  { path: 'display-picker/:roomName', component: DisplayPickerComponent },
  { path: 'B405', component: RealSpaceComponent },
  /** Dedicated full-screen slot view opened per physical screen by room devices */
  { path: 'slot-view', component: RoomDeviceViewComponent },
  { path: '**', redirectTo: '/hello', pathMatch: 'full' },
];
