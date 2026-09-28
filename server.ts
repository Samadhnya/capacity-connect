import express from 'express';
import { createServer as createViteServer } from 'vite';
import {
  getTraineeProfile,
  updateTraineeProfile,
  getTraineeDashboardData,
  getTraineeEnrolledCourses,
  getTraineeCertificates,
  getTraineeNotifications,
  markNotificationAsRead,
  getAllCourses,
  getCourseById,
  enrollTraineeInCourse,
  updateCourseProgress,
  getTrainerCourses,
  createCourse,
  updateCourse,
  deleteCourse,
  getCourseModules,
  addCourseModule,
  getCourseEnrolledTrainees,
} from './src/db/queries.ts';

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());

// Helper to extract authenticated user email / identifier from request headers
function getAuthenticatedEmail(req: express.Request): string {
  const authHeader = req.headers['x-user-email'];
  if (typeof authHeader === 'string' && authHeader.trim()) {
    return authHeader.trim().toLowerCase();
  }
  return 'arjun.singhania@imd.gov.in';
}

// -----------------------------------------------------------------------------
// COURSE DISCOVERY & DETAILS ENDPOINTS
// -----------------------------------------------------------------------------

// 1. GET /api/courses - List all courses with category, level, trainer, rating, enrolledCount, isEnrolled
app.get('/api/courses', async (req, res) => {
  try {
    const userEmail = getAuthenticatedEmail(req);
    const courses = await getAllCourses(userEmail);
    res.json({
      success: true,
      courses,
    });
  } catch (error: any) {
    console.error('API Error in GET /api/courses:', error);
    res.status(500).json({ error: error.message || 'Failed to fetch courses' });
  }
});

// 2. GET /api/courses/:id - Detailed course view with syllabus modules and enrollment status
app.get('/api/courses/:id', async (req, res) => {
  try {
    const courseId = req.params.id;
    const userEmail = getAuthenticatedEmail(req);
    const course = await getCourseById(courseId, userEmail);

    if (!course) {
      return res.status(404).json({ error: 'Course not found' });
    }

    res.json({
      success: true,
      course,
    });
  } catch (error: any) {
    console.error(`API Error in GET /api/courses/${req.params.id}:`, error);
    res.status(500).json({ error: error.message || 'Failed to fetch course details' });
  }
});

// 3. POST /api/courses - Trainer creates a new course
app.post('/api/courses', async (req, res) => {
  try {
    const userEmail = getAuthenticatedEmail(req);
    const user = await getTraineeProfile(userEmail);

    if (!user || (user.role !== 'Trainer' && user.role !== 'Admin')) {
      return res.status(403).json({ error: 'Forbidden: Only verified Trainers or Admins can author courses' });
    }

    const { title, description, category, duration, level, status, modules } = req.body;
    if (!title || !category) {
      return res.status(400).json({ error: 'Title and category are required' });
    }

    const newCourse = await createCourse(userEmail, {
      title,
      description: description || '',
      category,
      duration: duration || '6 Weeks',
      level: level || 'Intermediate',
      status: status || 'PUBLISHED',
      modules: Array.isArray(modules) ? modules : [],
    });

    res.status(201).json({
      success: true,
      message: 'Course authored and stored in PostgreSQL successfully',
      course: newCourse,
    });
  } catch (error: any) {
    console.error('API Error in POST /api/courses:', error);
    res.status(500).json({ error: error.message || 'Failed to create course' });
  }
});

// 4. PUT /api/courses/:id - Trainer edits their own course
app.put('/api/courses/:id', async (req, res) => {
  try {
    const courseId = req.params.id;
    const userEmail = getAuthenticatedEmail(req);
    const { title, description, category, duration, level, status } = req.body;

    const updated = await updateCourse(courseId, userEmail, {
      title,
      description,
      category,
      duration,
      level,
      status,
    });

    res.json({
      success: true,
      message: 'Course updated successfully',
      course: updated,
    });
  } catch (error: any) {
    console.error(`API Error in PUT /api/courses/${req.params.id}:`, error);
    const statusCode = error.message.includes('Unauthorized') ? 403 : error.message.includes('not found') ? 404 : 500;
    res.status(statusCode).json({ error: error.message });
  }
});

// 5. DELETE /api/courses/:id - Trainer deletes their own course
app.delete('/api/courses/:id', async (req, res) => {
  try {
    const courseId = req.params.id;
    const userEmail = getAuthenticatedEmail(req);

    await deleteCourse(courseId, userEmail);
    res.json({
      success: true,
      message: `Course ${courseId} successfully deleted`,
    });
  } catch (error: any) {
    console.error(`API Error in DELETE /api/courses/${req.params.id}:`, error);
    const statusCode = error.message.includes('Unauthorized') ? 403 : 500;
    res.status(statusCode).json({ error: error.message });
  }
});

// -----------------------------------------------------------------------------
// ENROLLMENT ENDPOINTS
// -----------------------------------------------------------------------------

// 6. POST /api/enrollments - Trainee enrolls in a course
app.post('/api/enrollments', async (req, res) => {
  try {
    const { courseId } = req.body;
    if (!courseId) {
      return res.status(400).json({ error: 'courseId is required' });
    }

    const userEmail = getAuthenticatedEmail(req);
    const user = await getTraineeProfile(userEmail);

    if (!user) {
      return res.status(401).json({ error: 'Authentication required to enroll' });
    }

    const result = await enrollTraineeInCourse(courseId, userEmail);
    if (result.alreadyEnrolled) {
      return res.status(200).json({
        success: true,
        alreadyEnrolled: true,
        message: result.message,
        enrollment: result.enrollment,
      });
    }

    res.status(201).json({
      success: true,
      alreadyEnrolled: false,
      message: result.message,
      enrollment: result.enrollment,
    });
  } catch (error: any) {
    console.error('API Error in POST /api/enrollments:', error);
    res.status(500).json({ error: error.message || 'Failed to enroll in course' });
  }
});

// 7. GET /api/enrollments/my - Logged-in trainee's enrolled courses with progress
app.get('/api/enrollments/my', async (req, res) => {
  try {
    const userEmail = getAuthenticatedEmail(req);
    const user = await getTraineeProfile(userEmail);

    if (!user) {
      return res.status(404).json({ error: 'Trainee account not found' });
    }

    const enrollments = await getTraineeEnrolledCourses(user.id);
    res.json({
      success: true,
      courses: enrollments,
    });
  } catch (error: any) {
    console.error('API Error in GET /api/enrollments/my:', error);
    res.status(500).json({ error: error.message || 'Failed to fetch enrolled courses' });
  }
});

// 8. GET /api/courses/:id/enrollments - Enrolled trainees for a course (for trainer)
app.get('/api/courses/:id/enrollments', async (req, res) => {
  try {
    const courseId = req.params.id;
    const trainees = await getCourseEnrolledTrainees(courseId);
    res.json({
      success: true,
      trainees,
    });
  } catch (error: any) {
    console.error(`API Error in GET /api/courses/${req.params.id}/enrollments:`, error);
    res.status(500).json({ error: error.message });
  }
});

// -----------------------------------------------------------------------------
// COURSE MODULES ENDPOINTS
// -----------------------------------------------------------------------------

// 9. GET /api/courses/:id/modules - Retrieve modules
app.get('/api/courses/:id/modules', async (req, res) => {
  try {
    const courseId = req.params.id;
    const modules = await getCourseModules(courseId);
    res.json({
      success: true,
      modules,
    });
  } catch (error: any) {
    console.error(`API Error in GET /api/courses/${req.params.id}/modules:`, error);
    res.status(500).json({ error: error.message });
  }
});

// 10. POST /api/courses/:id/modules - Add a module
app.post('/api/courses/:id/modules', async (req, res) => {
  try {
    const courseId = req.params.id;
    const userEmail = getAuthenticatedEmail(req);
    const { title, duration, moduleOrder } = req.body;

    if (!title || typeof title !== 'string') {
      return res.status(400).json({ error: 'Module title is required' });
    }

    const newModule = await addCourseModule(courseId, userEmail, {
      title: title.trim(),
      duration: duration || '1 Week',
      moduleOrder: moduleOrder || 1,
    });

    res.status(201).json({
      success: true,
      module: newModule,
    });
  } catch (error: any) {
    console.error(`API Error in POST /api/courses/${req.params.id}/modules:`, error);
    const statusCode = error.message.includes('Unauthorized') ? 403 : 500;
    res.status(statusCode).json({ error: error.message });
  }
});

// 11. PATCH /api/courses/:id/progress - Update trainee learning progress in a course
app.patch('/api/courses/:id/progress', async (req, res) => {
  try {
    const courseId = req.params.id;
    const userEmail = getAuthenticatedEmail(req);
    const { progress, lastActivity } = req.body;

    if (typeof progress !== 'number') {
      return res.status(400).json({ error: 'Progress must be a number from 0 to 100' });
    }

    const updated = await updateCourseProgress(courseId, userEmail, progress, lastActivity);
    res.json({
      success: true,
      enrollment: updated,
    });
  } catch (error: any) {
    console.error(`API Error in PATCH /api/courses/${req.params.id}/progress:`, error);
    res.status(500).json({ error: error.message });
  }
});

// -----------------------------------------------------------------------------
// TRAINER COURSE LIST ENDPOINT
// -----------------------------------------------------------------------------
app.get('/api/trainer/courses', async (req, res) => {
  try {
    const userEmail = getAuthenticatedEmail(req);
    const trainerCourses = await getTrainerCourses(userEmail);
    res.json({
      success: true,
      courses: trainerCourses,
    });
  } catch (error: any) {
    console.error('API Error in GET /api/trainer/courses:', error);
    res.status(500).json({ error: error.message });
  }
});

// -----------------------------------------------------------------------------
// TRAINEE PROFILE & DASHBOARD ENDPOINTS (STEP 4 PRESERVED)
// -----------------------------------------------------------------------------
app.get('/api/trainee/profile', async (req, res) => {
  try {
    const email = getAuthenticatedEmail(req);
    const profile = await getTraineeProfile(email);

    if (!profile) {
      return res.status(404).json({ error: 'Trainee profile not found' });
    }

    res.json({
      success: true,
      profile: {
        id: profile.id,
        uid: profile.uid,
        email: profile.email,
        name: profile.name,
        phone: profile.phone,
        role: profile.role,
        department: profile.department,
        designation: profile.designation,
        division: profile.division,
        location: profile.location,
        qualification: profile.qualification,
        workExperience: profile.workExperience,
        skills: profile.skills ? profile.skills.split(',').map((s) => s.trim()) : [],
        interests: profile.interests ? profile.interests.split(',').map((s) => s.trim()) : [],
        specialization: profile.specialization,
        employeeId: profile.employeeId,
        joiningYear: profile.joiningYear,
      },
    });
  } catch (error: any) {
    console.error('API Error in /api/trainee/profile:', error);
    res.status(500).json({ error: error.message || 'Failed to load trainee profile' });
  }
});

app.put('/api/trainee/profile', async (req, res) => {
  try {
    const email = getAuthenticatedEmail(req);
    const {
      name,
      phone,
      department,
      designation,
      division,
      location,
      qualification,
      workExperience,
      skills,
      interests,
      specialization,
    } = req.body;

    if (!name || typeof name !== 'string') {
      return res.status(400).json({ error: 'Full name is required' });
    }

    const updated = await updateTraineeProfile(email, {
      name: name.trim(),
      phone: phone ? phone.trim() : null,
      department: department ? department.trim() : null,
      designation: designation ? designation.trim() : null,
      division: division ? division.trim() : null,
      location: location ? location.trim() : null,
      qualification: qualification ? qualification.trim() : null,
      workExperience: workExperience ? workExperience.trim() : null,
      skills: Array.isArray(skills) ? skills.join(', ') : skills || null,
      interests: Array.isArray(interests) ? interests.join(', ') : interests || null,
      specialization: specialization ? specialization.trim() : null,
    });

    res.json({
      success: true,
      message: 'Profile updated successfully in PostgreSQL database',
      profile: updated,
    });
  } catch (error: any) {
    console.error('API Error in PUT /api/trainee/profile:', error);
    res.status(500).json({ error: error.message || 'Failed to update trainee profile' });
  }
});

app.get('/api/trainee/dashboard', async (req, res) => {
  try {
    const email = getAuthenticatedEmail(req);
    const user = await getTraineeProfile(email);

    if (!user) {
      return res.status(404).json({ error: 'Trainee not found' });
    }

    const dashboardData = await getTraineeDashboardData(user.id);
    res.json({
      success: true,
      dashboard: dashboardData,
    });
  } catch (error: any) {
    console.error('API Error in /api/trainee/dashboard:', error);
    res.status(500).json({ error: error.message || 'Failed to load dashboard data' });
  }
});

app.get('/api/trainee/courses', async (req, res) => {
  try {
    const email = getAuthenticatedEmail(req);
    const user = await getTraineeProfile(email);

    if (!user) {
      return res.status(404).json({ error: 'Trainee not found' });
    }

    const enrolled = await getTraineeEnrolledCourses(user.id);
    res.json({
      success: true,
      courses: enrolled,
    });
  } catch (error: any) {
    console.error('API Error in /api/trainee/courses:', error);
    res.status(500).json({ error: error.message || 'Failed to load enrolled courses' });
  }
});

app.get('/api/trainee/certificates', async (req, res) => {
  try {
    const email = getAuthenticatedEmail(req);
    const user = await getTraineeProfile(email);

    if (!user) {
      return res.status(404).json({ error: 'Trainee not found' });
    }

    const certs = await getTraineeCertificates(user.id);
    res.json({
      success: true,
      certificates: certs,
    });
  } catch (error: any) {
    console.error('API Error in /api/trainee/certificates:', error);
    res.status(500).json({ error: error.message || 'Failed to load certificates' });
  }
});

app.get('/api/trainee/notifications', async (req, res) => {
  try {
    const email = getAuthenticatedEmail(req);
    const user = await getTraineeProfile(email);

    if (!user) {
      return res.status(404).json({ error: 'Trainee not found' });
    }

    const notifs = await getTraineeNotifications(user.id);
    res.json({
      success: true,
      notifications: notifs,
    });
  } catch (error: any) {
    console.error('API Error in /api/trainee/notifications:', error);
    res.status(500).json({ error: error.message || 'Failed to load notifications' });
  }
});

app.patch('/api/trainee/notifications/:id/read', async (req, res) => {
  try {
    const email = getAuthenticatedEmail(req);
    const user = await getTraineeProfile(email);
    const notificationId = parseInt(req.params.id, 10);

    if (!user) {
      return res.status(404).json({ error: 'Trainee not found' });
    }
    if (isNaN(notificationId)) {
      return res.status(400).json({ error: 'Invalid notification id' });
    }

    const updated = await markNotificationAsRead(notificationId, user.id);
    res.json({
      success: true,
      notification: updated,
    });
  } catch (error: any) {
    console.error('API Error in marking notification read:', error);
    res.status(500).json({ error: error.message || 'Failed to mark notification as read' });
  }
});

// -----------------------------------------------------------------------------
// Mount Vite middlewares for HMR and SPA serving
// -----------------------------------------------------------------------------
async function startServer() {
  const isProd = process.env.NODE_ENV === 'production';

  if (!isProd) {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    app.use(express.static('dist'));
    app.get('*', (req, res) => {
      res.sendFile('index.html', { root: 'dist' });
    });
  }

  app.listen(PORT, () => {
    console.log(`Server running at http://localhost:${PORT}`);
  });
}

startServer();
