# Relievo – AI-Powered Disaster Response & Emergency Coordination

**Connecting citizens, coordinators, and volunteers through intelligent emergency response and real-time collaboration.**

Relievo is an AI-assisted disaster-response coordination platform designed to improve how emergency incidents are reported, verified, prioritized, and resolved. It connects citizens who need assistance with coordinators and volunteers who can provide support.

The platform uses AI-assisted information extraction, explainable volunteer matching, real-time communication, emergency SOS alerts, and incident tracking to streamline disaster-response operations.

**Hackathon:** Nexconn Build Challenge 2026  
**Theme:** Humanitarian & Social Good

---

## 1. Problem Statement

During emergencies and disasters, people often struggle to receive timely assistance because of:

- Delayed communication between citizens and response teams.
- Unstructured emergency reports with incomplete information.
- Difficulty identifying suitable and available volunteers.
- Lack of centralized incident tracking.
- Limited coordination between volunteers and emergency coordinators.

Relievo addresses these challenges through a unified emergency-response coordination system.

## 2. Our Solution

Relievo provides a centralized platform where citizens can report emergencies, coordinators can verify incidents, and volunteers can be matched with suitable response tasks.

AI assists in extracting important information from emergency reports, while a human coordinator retains control over verification and volunteer assignments.

The platform also provides real-time communication, SOS functionality, notifications, resource allocation, and impact monitoring.

## 3. Key Features

### Citizen Features
- Emergency incident reporting.
- Voice-to-text reporting in English (India), Hindi, and Telugu.
- Location-based incident submission.
- Real-time incident status and progress tracking.
- Emergency SOS with location sharing.
- Audio recording and transcription during SOS.
- Incident-specific communication.

### Coordinator Features
- Centralized emergency command centre.
- AI-assisted incident information extraction.
- Incident verification, editing, and rejection.
- Priority-based incident management.
- Explainable volunteer matching.
- Automated volunteer recommendations.
- Assignment approval and reassignment.
- Resource allocation and incident resolution.
- Impact dashboard and incident timeline.

### Volunteer Features
- Volunteer profile and skill management.
- Availability management.
- Emergency assignment notifications.
- Accept or decline assignments.
- Incident-specific group communication.
- Direct messaging with coordinators.
- Volunteer hub for collaboration.

### AI-Assisted Capabilities
- Extraction of structured information from emergency reports.
- Identification of incident categories and urgency.
- Missing-information detection.
- Explainable volunteer recommendation scores.
- AI-generated suggestions with human verification.

### Real-Time Communication
- Incident-specific group chats.
- Direct messaging between coordinators and volunteers.
- Volunteer collaboration hub.
- Notifications and emergency alerts.

## 4. How Relievo Works

1. **Incident Reporting:** Citizens submit emergency reports using text or voice input.
2. **AI Analysis:** The system extracts structured information from the submitted report.
3. **Human Verification:** Coordinators review the original report and AI-generated suggestions before verifying or rejecting the incident.
4. **Priority Assessment:** Incidents are organized according to urgency and priority.
5. **Volunteer Matching:** The system ranks eligible volunteers based on distance, skills, availability, and capacity.
6. **Assignment Approval:** Coordinators review recommendations and approve suitable volunteers.
7. **Real-Time Coordination:** Incident-specific communication rooms connect coordinators and assigned volunteers.
8. **Resolution:** Coordinators manage resources, monitor progress, and mark incidents as resolved.
9. **Impact Monitoring:** The platform maintains incident timelines and response metrics.

## 5. Volunteer Matching Algorithm

Relievo uses an explainable weighted scoring mechanism to recommend suitable volunteers.

The matching formula is:

**S = 0.35D + 0.30K + 0.20A + 0.15C**

Where:

- **D – Distance:** Geographical proximity between the incident and volunteer.
- **K – Skills:** Compatibility between required incident skills and volunteer skills.
- **A – Availability:** Current volunteer availability.
- **C – Capacity:** Remaining volunteer assignment capacity.

The system excludes unsuitable volunteers, including unverified, offline, busy, or over-capacity volunteers, and applies additional qualification requirements for medical and rescue assignments.

The final recommendations are explainable, allowing coordinators to understand why a volunteer is suggested.

## 6. Technology Stack

| Component | Technologies |
|---|---|
| Frontend | React, TypeScript, Vite |
| Styling | Tailwind CSS |
| Backend | Node.js, Express.js |
| Programming Language | TypeScript |
| Database | Supabase |
| Authentication | Supabase Auth |
| AI Integration | OpenRouter |
| Communication | Nexconn Chat SDK |
| Maps | Leaflet, React Leaflet |
| Testing | Vitest |
| Deployment | Vercel, Render |

## 7. Project Architecture

```text
                 RELIEVO PLATFORM
                         |
          +--------------+--------------+
          |              |              |
       Citizens      Coordinators    Volunteers
          |              |              |
          +--------------+--------------+
                         |
                  React Frontend
                         |
                  Express Backend
                         |
        +----------------+----------------+
        |                |                |
    AI Analysis      Supabase         Nexconn
        |                |                |
  Report Extraction  Data Storage   Real-Time Chat
        |                |                |
        +----------------+----------------+
                         |
               Incident Management
                         |
             Tracking & Impact Dashboard
```

## 8. Getting Started

### Prerequisites

- Node.js 20 or later
- npm
- Git
- Supabase account (for production database integration)

### Clone the Repository

```bash
git clone https://github.com/SriHasa26/Relievo.1.git
cd Relievo.1
```

### Install Dependencies

```bash
npm install
```

### Configure Environment Variables

Create the backend environment file:

```bash
cp backend/.env.example backend/.env
```

Create the frontend environment file:

```bash
cp frontend/.env.example frontend/.env
```

For the local mock setup, enable:

**Backend (`backend/.env`):**

```env
MOCK_CHAT=true
MOCK_AI=true
MOCK_DB=true
```

Configure the remaining environment variables using the provided example files.

### Run the Application

```bash
npm run dev
```

The application runs locally at:

- Frontend: http://localhost:5173
- Backend: http://localhost:4000

The mock setup uses in-memory data, which resets when the backend restarts.

## 9. Testing

Run backend tests:

```bash
npm test
```

Run TypeScript checks:

```bash
npm run typecheck
```

Additional verification scripts are available for database schema, Supabase, and Nexconn integrations.

## 10. Deployment

Relievo supports a deployment architecture using:

- **Frontend:** Vercel
- **Backend:** Render
- **Database:** Supabase
- **Communication:** Nexconn Chat SDK

Refer to [Deployment Guide](docs/DEPLOY.md) for complete deployment instructions and environment configuration.

## 11. Safety and Reliability

Relievo follows a human-in-the-loop approach to emergency response.

- AI-generated information is treated as decision support, not a final decision.
- Coordinators verify incidents before approving assignments.
- Volunteer recommendations include explainable scoring.
- Role-based access controls protect incident information.
- Backend authorization checks restrict access to sensitive operations.
- Rate limiting helps protect critical API endpoints.
- Synthetic demonstration data is used for testing and evaluation.

**Important:** Relievo is a coordination and decision-support platform. It does not replace official emergency services or professional emergency responders.

## 12. Future Scope

Potential areas for further development include:

- Enhanced AI-based emergency information extraction.
- Improved geographical volunteer matching.
- Predictive emergency-response analytics.
- Expanded multilingual accessibility.
- Integration with additional emergency-response organizations.
- Advanced disaster-impact monitoring and reporting.

## 13. Project Information

**Project Name:** Relievo  
**Category:** AI for Social Good / Disaster Management  
**Hackathon:** Nexconn Build Challenge 2026  
**Theme:** Humanitarian & Social Good

**Repository:** https://github.com/SriHasa26/Relievo.1

---

*Relievo – Turning emergency reports into coordinated action. Building a faster, smarter, and more connected disaster-response ecosystem.*
