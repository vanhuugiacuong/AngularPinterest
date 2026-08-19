import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Navbar } from '../../components/navbar/navbar';

@Component({
  selector: 'app-notifications',
  standalone: true,
  imports: [CommonModule, Navbar],
  templateUrl: './notifications.html',
  styleUrl: './notifications.css'
})
export class Notifications {}
