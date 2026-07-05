const userModel = require('../models/userModel');
const { db } = require('../database/db');

async function getSystemLogs(req, res) {
  try {
    const query = `
      SELECT al.log_id, al.action, al.ip_address, al.user_agent, al.timestamp, u.email, u.full_name
      FROM audit_logs al
      LEFT JOIN users u ON al.user_id = u.id
      ORDER BY al.timestamp DESC
      LIMIT 100
    `;
    const result = await db.query(query);
    return res.status(200).json({
      logs: result.rows,
      count: result.rows.length
    });
  } catch (error) {
    console.error('Error fetching system logs:', error);
    return res.status(500).json({ error: 'Failed to fetch logs' });
  }
}

async function getAllUsers(req, res) {
  try {
    const users = await userModel.getAllUsers();
    return res.status(200).json({
      users: users,
      count: users.length
    });
  } catch (error) {
    console.error('Error fetching users:', error);
    return res.status(500).json({ error: 'Failed to fetch users' });
  }
}

async function deleteUser(req, res) {
  try {
    const { userId } = req.params;
    if (!userId) {
      return res.status(400).json({ error: 'User ID is required' });
    }
    const deletedUser = await userModel.deleteUser(userId);
    if (!deletedUser) {
      return res.status(404).json({ error: 'User not found' });
    }
    return res.status(200).json({
      message: 'User deleted successfully',
      user: deletedUser
    });
  } catch (error) {
    console.error('Error deleting user:', error);
    return res.status(500).json({ error: 'Failed to delete user' });
  }
}

async function getSystemStats(req, res) {
  try {
    const totalUsers = await userModel.countUsers();
    const logsResult = await db.query('SELECT COUNT(*) as count FROM audit_logs');
    const totalLogs = parseInt(logsResult.rows[0].count);

    return res.status(200).json({
      stats: {
        totalUsers,
        totalLogs,
        systemHealth: 'Optimal'
      }
    });
  } catch (error) {
    console.error('Error fetching system stats:', error);
    return res.status(500).json({ error: 'Failed to fetch stats' });
  }
}

module.exports = {
  getSystemLogs, getAllUsers, deleteUser, getSystemStats
};
