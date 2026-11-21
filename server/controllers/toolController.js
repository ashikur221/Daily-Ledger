const Tool = require('../models/Tool');

const getTools = async (req, res) => {
  try {
    const { toolType } = req.query;
    const filter = { userId: req.user._id, isDeleted: false };
    if (toolType) filter.toolType = toolType;

    const tools = await Tool.find(filter).sort({ createdAt: -1 });
    res.json({ tools });
  } catch (err) {
    res.status(500).json({ message: 'Error fetching tools' });
  }
};

const createTool = async (req, res) => {
  try {
    const { localId, toolType, data, clientUpdatedAt } = req.body;
    if (!localId || !toolType) return res.status(400).json({ message: 'localId and toolType required' });

    const tool = await Tool.findOneAndUpdate(
      { userId: req.user._id, localId },
      { $set: { toolType, data, clientUpdatedAt, isDeleted: false } },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );
    res.status(201).json({ tool });
  } catch (err) {
    res.status(500).json({ message: 'Error creating tool' });
  }
};

const updateTool = async (req, res) => {
  try {
    const { localId } = req.params;
    const { data, clientUpdatedAt } = req.body;

    const tool = await Tool.findOneAndUpdate(
      { userId: req.user._id, localId },
      { $set: { data, clientUpdatedAt: clientUpdatedAt || new Date() } },
      { new: true }
    );
    if (!tool) return res.status(404).json({ message: 'Tool not found' });
    res.json({ tool });
  } catch (err) {
    res.status(500).json({ message: 'Error updating tool' });
  }
};

const deleteTool = async (req, res) => {
  try {
    const { localId } = req.params;
    const tool = await Tool.findOneAndUpdate(
      { userId: req.user._id, localId },
      { $set: { isDeleted: true } },
      { new: true }
    );
    if (!tool) return res.status(404).json({ message: 'Tool not found' });
    res.json({ message: 'Deleted' });
  } catch (err) {
    res.status(500).json({ message: 'Error deleting tool' });
  }
};

const syncTools = async (req, res) => {
  try {
    const { records } = req.body;
    if (!Array.isArray(records)) return res.status(400).json({ message: 'records array required' });

    const results = await Promise.allSettled(
      records.map(({ localId, toolType, data, clientUpdatedAt, isDeleted }) =>
        Tool.findOneAndUpdate(
          { userId: req.user._id, localId },
          { $set: { toolType, data, clientUpdatedAt, isDeleted: isDeleted || false } },
          { upsert: true, new: true, setDefaultsOnInsert: true }
        )
      )
    );

    const synced = results.filter((r) => r.status === 'fulfilled').map((r) => r.value.localId);
    res.json({ synced, failed: results.filter((r) => r.status === 'rejected').length });
  } catch (err) {
    res.status(500).json({ message: 'Sync error' });
  }
};

module.exports = { getTools, createTool, updateTool, deleteTool, syncTools };
