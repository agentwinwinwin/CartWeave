'use client';
import { useState } from 'react';
export default function NewsletterForm(){const [status,setStatus]=useState('');return <><form onSubmit={e=>{e.preventDefault();setStatus('Subscription simulated. No email was saved or sent.');}}><input type="email" aria-label="Test email address" value="demo@example.invalid" readOnly/><button type="submit">Join us →</button></form>{status&&<p role="status">{status}</p>}</>;}
